/** Operator import / read-only cloud recovery. No provider submit call exists here. */
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve,join,relative,isAbsolute } from "node:path";
import { createHash,randomUUID } from "node:crypto";
import { z } from "zod";
import { AurayVideoProvider,AurayError,aurayAuditionSchema,aurayAuditionKey } from "../apps/local-renderer/src/auray-video-provider.ts";
import { aurayAccountFingerprint,registeredAurayWallet,syncAurayMonitor,readAurayStudioBytes,aurayStudioRpcResult,type MonitoredAurayJob } from "../apps/local-renderer/src/auray-studio-sync.ts";
import { verifyAurayMedia } from "../apps/local-renderer/src/auray-media.ts";

const root=resolve(import.meta.dirname,".."), output=join(root,"output/auray-video-jobs");
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const sha=z.string().regex(/^[a-f0-9]{64}$/);
async function settings() {
  const values:Record<string,string>={};
  try {for(const line of (await readFile(join(root,".env.cloud"),"utf8")).split(/\r?\n/)) {
    const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if(m)values[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,"$2");
  }}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new AurayError("credential_file_unavailable");}
  return {...values,...process.env};
}
async function main() {
  const mode=process.argv[2], arg=process.argv[3], cfg=await settings();
  if(!["--register","--wallet","--connected"].includes(mode ?? ""))throw new AurayError("use_register_wallet_or_connected");
  const id=mode==="--connected" ? undefined : z.string().uuid().parse(arg), url=new URL(cfg.SUPABASE_URL || "");
  if(url.protocol!=="https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname!=="/")throw new AurayError("invalid_studio_url");
  const service=cfg.CONTENT_AI_SERVICE_ROLE_KEY || cfg.SUPABASE_SERVICE_ROLE_KEY;
  if(!service)throw new AurayError("missing_credentials");
  const headers={apikey:service,Authorization:`Bearer ${service}`};
  const request=async(path:string,init:RequestInit={})=>{
    const r=await fetch(url.origin+path,{...init,headers:{...headers,...init.headers},redirect:"error",signal:AbortSignal.timeout(25000)});
    return r;
  };
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    const r=await request(`/rest/v1/rpc/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)});
    return aurayStudioRpcResult(r);
  };
  const provider=new AurayVideoProvider(cfg.AURAY_API_KEY);
  let inspected:Awaited<ReturnType<typeof provider.inspect>>|undefined;
  let wallet=id;
  if(mode==="--connected") {
    const connected=registeredAurayWallet(await aurayStudioRpcResult(await request("/rest/v1/studio_auray_config?select=wallet_id&limit=2")));
    if(connected===null){process.stdout.write(JSON.stringify({code:"not_connected",production_ready:false})+"\n");return;}
    wallet=connected;
  }
  if(mode==="--register") {
    const report=inspected=await provider.inspect();if(!report.account_id)throw new AurayError("inspection_required");
    const paths=process.argv.slice(4);if(paths.length>50)throw new AurayError("too_many_jobs");
    const jobs=[];
    for(const path of paths) {
      const absolute=resolve(path),inside=relative(output,absolute);
      if(!inside || inside.startsWith("..") || isAbsolute(inside))throw new AurayError("use_original_checkpoint");
      const state=z.object({version:z.literal(1),account_id:z.string().uuid(),period:z.string().regex(/^\d{4}-\d{2}$/),
        contract_sha256:sha,request_key:sha,job_id:z.string(),shot:aurayAuditionSchema,
        phase:z.enum(["submission_started","submitted","submission_unknown","waiting","failed","downloaded","review_pending"]),output_sha256:sha.optional()}).parse(JSON.parse(await readFile(absolute,"utf8")));
      const expected=aurayAuditionKey(state.shot,{account_id:state.account_id,period:state.period,contract_sha256:state.contract_sha256} as Parameters<typeof aurayAuditionKey>[1]);
      if(state.shot.chapter_binding)throw new AurayError("use_native_chapter_worker");
      if(state.account_id!==report.account_id || expected!==state.request_key || state.job_id!==`video_${expected}` || absolute!==join(output,expected,"state.json"))throw new AurayError("checkpoint_mismatch");
      jobs.push({request_key:expected,external_id:state.job_id,kind:state.shot.kind,aspect_ratio:state.shot.aspect_ratio,
        label:state.shot.native_dialogue?.speaker || "Reação visual",expected_sha256:state.output_sha256 ?? null});
    }
    wallet=z.string().uuid().parse(await rpc("register_auray_monitor",{p_workspace:id,p_account:aurayAccountFingerprint(report.account_id),p_jobs:jobs}));
  }
  const collect=async(job:MonitoredAurayJob)=>{
    const folder=join(output,job.external_id.slice(6));await mkdir(folder,{recursive:true});
    const file=join(folder,"original.mp4");let bytes:Uint8Array|undefined;
    if(job.expected_sha256){try {const local=await readFile(file);if(hash(local)!==job.expected_sha256)throw new AurayError("cached_output_changed");bytes=local;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
    if(!bytes) {bytes=await provider.download(job.external_id);if(job.expected_sha256 && hash(bytes)!==job.expected_sha256)throw new AurayError("cached_output_changed");await writeFile(file,bytes,{mode:0o600});}
    await verifyAurayMedia(file,{kind:job.kind,aspect_ratio:job.aspect_ratio});
    if(bytes.length>50*1024*1024)throw new AurayError("private_storage_size_limit");
    const outputHash=hash(bytes),path=`auray/${wallet}/${job.id}/${outputHash}.mp4`;
    const storage=`/storage/v1/object/studio-private/${path}`;
    const uploaded=await request(storage,{method:"POST",headers:{"Content-Type":"video/mp4","x-upsert":"false"},body:new Uint8Array(bytes)}).catch(()=>null);
    if(!uploaded?.ok) {
      // An interrupted upload may have succeeded. Verify the immutable bytes; never overwrite.
      const existing=await request(storage);if(!existing.ok || hash(await readAurayStudioBytes(existing,64*1024*1024))!==outputHash)throw new AurayError("storage_upload_unresolved");
    }
    return {output_sha256:outputHash,bytes:bytes.length};
  };
  const inspect=async()=>{
    if(!cfg.AURAY_API_KEY)throw new AurayError("missing_api_key");
    return inspected && Date.now()-Date.parse(inspected.checked_at)>=0 && Date.now()-Date.parse(inspected.checked_at)<60000 ? inspected : provider.inspect();
  };
  const result=await syncAurayMonitor(z.string().uuid().parse(wallet),randomUUID(),{inspect,status:id=>provider.status(id),collect,rpc});
  process.stdout.write(JSON.stringify({wallet_id:wallet,...result})+"\n");
}
try {await main();} catch(e) {
  process.stderr.write(JSON.stringify({status:"blocked",code:e instanceof AurayError ? e.code : "sync_failed",production_ready:false})+"\n");process.exitCode=1;
}
