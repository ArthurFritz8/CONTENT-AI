/** Imports existing, reviewed local media. No generation or provider calls. */
import {readFile,stat,realpath} from "node:fs/promises";
import {resolve,join,relative,isAbsolute} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {z} from "zod";
import {storyStyleSampleSchema} from "../packages/core/src/stories/styles.ts";
import {aurayStudioRpcResult,readAurayStudioBytes} from "../apps/local-renderer/src/auray-studio-sync.ts";
const root=resolve(import.meta.dirname,".."),output=join(root,"output"),hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function main() {
  const workspace=z.string().uuid().parse(process.argv[2]);
  if(!process.argv[3])throw Error("manifest_required");
  const entries=z.array(z.object({path:z.string().min(1),sample:storyStyleSampleSchema}).strict()).min(1).max(10).parse(JSON.parse(await readFile(resolve(process.argv[3]),"utf8")));
  const values:Record<string,string>={};
  for(const line of (await readFile(join(root,".env.cloud"),"utf8")).replace(/^\uFEFF/,"").split(/\r?\n/)) {
    const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(m)values[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,"$2");
  }
  const cfg={...values,...process.env},url=new URL(cfg.SUPABASE_URL || ""),service=cfg.CONTENT_AI_SERVICE_ROLE_KEY || cfg.SUPABASE_SERVICE_ROLE_KEY;
  if(url.protocol!=="https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || !service)throw Error("invalid_studio_config");
  const request=(path:string,init:RequestInit={})=>fetch(url.origin+path,{...init,headers:{apikey:service,Authorization:`Bearer ${service}`,...init.headers},redirect:"error",signal:AbortSignal.timeout(30000)});
  const rpc=async(name:string,args:Record<string,unknown>)=>aurayStudioRpcResult(await request(`/rest/v1/rpc/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}));
  const verified=[];
  // Verify the entire manifest before writing any remote row or file.
  for(const entry of entries) {
    const file=await realpath(resolve(root,entry.path)),inside=relative(output,file);
    if(!inside || inside.startsWith("..") || isAbsolute(inside))throw Error("media_outside_output");
    if((await stat(file)).size!==entry.sample.bytes)throw Error("media_size_changed");
    const bytes=await readFile(file);if(hash(bytes)!==entry.sample.sha256)throw Error("media_hash_changed");
    const result=spawnSync("ffprobe",["-v","error","-count_frames","-show_streams","-of","json",file],{encoding:"utf8",windowsHide:true,timeout:30000});
    if(result.status!==0)throw Error("media_probe_failed");
    const streams=JSON.parse(result.stdout).streams,videos=streams.filter((v:{codec_type:string})=>v.codec_type==="video"),v=videos[0];
    const [numerator,denominator]=String(v?.avg_frame_rate).split("/").map(Number),fps=Number(numerator)/Number(denominator);
    if(videos.length!==1 || v.width!==entry.sample.width || v.height!==entry.sample.height || Math.abs(fps-entry.sample.output_fps)>.001 ||
      !Number.isFinite(Number(v.duration)) || Math.abs(Number(v.duration)-entry.sample.seconds)>.05 || Number(v.nb_read_frames)<1 ||
      streams.some((v:{codec_type:string})=>v.codec_type==="audio")!==entry.sample.has_audio)throw Error("media_metadata_changed");
    if(spawnSync("ffmpeg",["-nostdin","-v","error","-xerror","-i",file,"-f","null","-"],{encoding:"utf8",windowsHide:true,timeout:120000}).status!==0)throw Error("media_decode_failed");
    verified.push({entry,bytes});
  }
  for(const {entry,bytes} of verified) {
    const row=z.object({id:z.literal(entry.sample.id),path:z.literal(`${workspace}/story-samples/${entry.sample.id}/${entry.sample.sha256}.mp4`),ready:z.boolean()}).parse(await rpc("register_story_style_sample",{p_workspace:workspace,p_sample:entry.sample}));
    if(!row.ready) {
      const path=`/storage/v1/object/studio-private/${row.path}`;
      const uploaded=await request(path,{method:"POST",headers:{"Content-Type":"video/mp4","x-upsert":"false"},body:new Uint8Array(bytes)}).catch(()=>null);
      if(!uploaded?.ok) {const existing=await request(path);if(!existing.ok || hash(await readAurayStudioBytes(existing,50*1024*1024))!==entry.sample.sha256)throw Error("sample_upload_unresolved");}
      await rpc("ready_story_style_sample",{p_workspace:workspace,p_id:entry.sample.id,p_sha:entry.sample.sha256});
    }
  }
  console.log(JSON.stringify({code:"imported",samples:verified.length,new_generations:0}));
}
try {await main();}catch {console.error(JSON.stringify({code:"sample_import_failed",new_generations:0}));process.exitCode=1;}
