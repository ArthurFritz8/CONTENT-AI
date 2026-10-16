/** Service-only Puter worker: one saved intent per take, native files, review only. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import sharp from "sharp";
import {z} from "zod";
import {PuterVideoProvider,PuterError} from "../apps/local-renderer/src/puter-video-provider.ts";
import {createPuterRun,advancePuterChapter,validatePuterRun,type PuterRun} from "../apps/local-renderer/src/puter-native-chapter.ts";
import {readAurayStudioBytes,aurayStudioRpcResult} from "../apps/local-renderer/src/auray-studio-sync.ts";
import {buildNativeScript} from "../packages/core/src/stories/native-chapter.ts";
import {computeScriptHash,canonicalStringify} from "../packages/core/src/validators/hash-utils.ts";
import {createScriptQualityChecker} from "../packages/core/src/validators/script-quality.ts";
import {reviewNativeMedia} from "./lib/native-media-review.mts";
const root=resolve(import.meta.dirname,".."),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const env:Record<string,string>={};
try{for(const line of (await readFile(join(root,".env.cloud"),"utf8")).replace(/^\uFEFF/,"").split(/\r?\n/)) {
 const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(m)env[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,"$2");
}}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new PuterError("credential_file_unavailable");}
const cfg={...env,...process.env},origin=new URL(cfg.SUPABASE_URL||"");
if(origin.protocol!=="https:"||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)||origin.username||origin.password||origin.port||origin.pathname!=="/")throw new PuterError("invalid_studio_url");
const service=cfg.CONTENT_AI_SERVICE_ROLE_KEY||cfg.SUPABASE_SERVICE_ROLE_KEY;if(!service)throw new PuterError("missing_credentials");
const request=(path:string,init:RequestInit={})=>fetch(origin.origin+path,{...init,headers:{apikey:service,Authorization:`Bearer ${service}`,...init.headers},redirect:"error",signal:AbortSignal.timeout(25000)});
const rpc=async(name:string,args:Record<string,unknown>)=>aurayStudioRpcResult(await request(`/rest/v1/rpc/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}));
const reply=z.object({code:z.string().regex(/^[a-z_]{1,80}$/)});
const claimSchema=z.discriminatedUnion("code",[
 z.object({code:z.literal("claimed"),credential:z.string().min(16).max(8192),account_sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
 z.object({code:z.enum(["account_busy","finished","connection_required","cooldown"])})]);
const admissionSchema=z.discriminatedUnion("code",[
 z.object({code:z.literal("prepare"),account_id:z.string().uuid(),state:z.unknown().optional(),profile:z.unknown(),context:z.unknown(),draft:z.unknown(),fingerprint:z.string().optional()}),
 z.object({code:z.enum(["finished","cancelled","connection_required","native_setup_required"])})]);
let reportFailure:((code:string)=>Promise<unknown>)|undefined;
async function main() {
 const input=process.env.NATIVE_EPISODE_ID||process.argv[2];
 if(!input) {
  for(const id of z.array(z.string().uuid()).max(3).parse(await rpc("puter_monitor_accounts",{}))) {
   const token=randomUUID(),base={p_account:id,p_token:token};
   const claim=claimSchema.parse(await rpc("claim_puter_inspection",base));if(claim.code!=="claimed")continue;
   try{const report=await new PuterVideoProvider(claim.credential).inspect();await rpc("finish_puter_inspection",{...base,p_observation:report});}
   catch{await rpc("finish_puter_inspection",{...base,p_observation:null,p_error:"inspection_unavailable"});}
  }
  for(const id of z.array(z.string().uuid()).max(3).parse(await rpc("puter_recovery_episodes",{}))) {
   const child=spawnSync(process.execPath,["--experimental-strip-types",resolve(import.meta.filename),id],{env:{...process.env,NATIVE_EPISODE_ID:id},stdio:"inherit",timeout:36*60_000,windowsHide:true});
   if(child.status!==0)process.exitCode=1;
  }return;
 }
 const episode=z.string().uuid().parse(input),token=randomUUID(),base={p_episode:episode,p_token:token};
 reportFailure=code=>rpc("puter_worker_result",{p_episode:episode,p_code:code});
 const admission=admissionSchema.parse(await rpc("puter_worker_input",{p_episode:episode}));if(admission.code!=="prepare"){await reportFailure(admission.code);return;}
 const claim=claimSchema.parse(await rpc("claim_puter_chapter",{...base,p_account:admission.account_id}));if(claim.code!=="claimed"){await reportFailure(claim.code);return;}
 try {
 const provider=new PuterVideoProvider(claim.credential);
 const inspect=async()=>{const report=await provider.inspect();await rpc("observe_puter_chapter",{...base,p_observation:report});return report;};
 let state:PuterRun;
 if(admission.state)state=await validatePuterRun(admission.state);
 else {
  state=await createPuterRun({episode_id:episode,profile:admission.profile,context:admission.context,draft:admission.draft},await inspect());
  const reservation=reply.parse(await rpc("reserve_puter_chapter",{...base,p_account:admission.account_id,p_run:state}));
  if(!["reserved","existing"].includes(reservation.code)){await reportFailure(reservation.code);return;}
  // An ambiguous prior reservation is read back, never replaced by a new run.
  if(reservation.code==="existing"){const prior=admissionSchema.parse(await rpc("puter_worker_input",{p_episode:episode}));if(prior.code!=="prepare")throw new PuterError("native_checkpoint_mismatch");state=await validatePuterRun(prior.state);}
 }
 const dir=join(root,"output/puter-chapters",episode);await mkdir(dir,{recursive:true});
 const privateBytes=async(path:string,maximum:number)=>{
  if(!/^[a-zA-Z0-9_./-]+$/.test(path)||path.includes(".."))throw new PuterError("invalid_private_path");
  const r=await request(`/storage/v1/object/studio-private/${path}`);if(!r.ok)throw new PuterError("private_media_unavailable");return readAurayStudioBytes(r,maximum);
 };
 const put=async(bytes:Uint8Array,extension:"mp4"|"json")=>{
  if(!bytes.length||bytes.length>50*1024*1024)throw new PuterError("private_storage_size_limit");
  const sha256=hash(bytes),path=`episodes/${episode}/native/${sha256}.${extension}`;
  const r=await request(`/storage/v1/object/studio-private/${path}`,{method:"POST",headers:{"Content-Type":extension==="mp4"?"video/mp4":"application/json","x-upsert":"false"},body:new Uint8Array(bytes)}).catch(()=>null);
  if(!r?.ok&&hash(await privateBytes(path,50*1024*1024))!==sha256)throw new PuterError("storage_upload_unresolved");
  // Verify even a successful upload before allowing remote source cleanup.
  if(hash(await privateBytes(path,50*1024*1024))!==sha256)throw new PuterError("cached_output_changed");
  return {path,sha256,bytes:bytes.length};
 };
 const guard=async(submission=false)=>{await rpc("guard_puter_chapter",{...base,p_submission:submission});};
  const assemble=async(run:PuterRun)=>{
    const sources:Array<{path:string;sha256:string;speaker:string}>=[];
    for(const [i,t] of run.tasks.entries()) {
      if(!t.clip)throw new PuterError("native_clips_incomplete");
      const bytes=await privateBytes(t.clip.path,50*1024*1024);if(hash(bytes)!==t.clip.sha256)throw new PuterError("cached_output_changed");
      const file=join(dir,`take-${i}.mp4`);await writeFile(file,bytes,{mode:0o600});
      sources.push({path:file,sha256:t.clip.sha256,speaker:run.draft.scenes[i]!.visual.speaker_id});
    }
    await guard();const input=join(dir,"sources.json");await writeFile(input,JSON.stringify(sources),{mode:0o600});
    const assembled=spawnSync(process.env.PYTHON_EXECUTABLE||"python",["-X","utf8",join(root,"scripts/assemble_auray_sequence.py"),input,join(dir,"assembled"),"--fps","30"],{encoding:"utf8",timeout:180000,maxBuffer:1024*1024,windowsHide:true});
    if(assembled.status!==0)throw new PuterError("native_assembly_failed");
    let qa;
    try {qa=JSON.parse(assembled.stdout);}catch{throw new PuterError("native_assembly_invalid");}
    const frames=run.tasks.reduce((n,t)=>n+t.clip!.frames,0);
    if(qa.width!==720 || qa.height!==1280 || qa.encoded_fps!==30 || qa.frames!==frames || Math.abs(qa.seconds-frames/30)>1e-9 ||
      qa.all_decoded_frames_pixel_identical!==true || qa.video_reencoded!==false || qa.decode_verified!==true || qa.audio_encoded_once_from_native_pcm!==true ||
      qa.human_review_required!==true || qa.voice_continuity_approved!==false || qa.production_ready!==false || !Array.isArray(qa.cuts) || qa.cuts.length!==run.tasks.length ||
      qa.cuts.some((cut:Record<string,any>,i:number)=>cut.speaker!==sources[i]!.speaker || cut.source_sha256!==sources[i]!.sha256 || cut.frames!==run.tasks[i]!.clip!.frames ||
        cut.original_audio!==true || cut.audio_transport?.silent_reference || !Number.isFinite(cut.audio_transport?.correlation) || cut.audio_transport.correlation<.90 ||
        !Number.isFinite(cut.audio_transport?.measured_lag_seconds) || Math.abs(cut.audio_transport.measured_lag_seconds)>.02))throw new PuterError("native_assembly_invalid");
    const bytes=await readFile(join(dir,"assembled/sequence.mp4"));if(hash(bytes)!==qa.sha256)throw new PuterError("cached_output_changed");
    const script=await buildNativeScript({episode,context:run.context,profile:run.profile,draft:run.draft,clips:run.tasks.map(t=>t.clip!),origin:origin.origin});
    const qualityResponse=await request("/rest/v1/system_config?key=eq.fact_check&select=value");
    if(!qualityResponse.ok)throw new PuterError("quality_policy_unavailable");
    const policyRows=z.array(z.object({value:z.unknown()})).length(1).parse(await qualityResponse.json());
    const quality=createScriptQualityChecker(policyRows[0]!.value)(script,[],false);
    if(!quality.passed)throw new PuterError("native_script_quality_failed");
    // Remove workstation paths from the receipt stored in the private workspace.
    const {file:ignored,...publicQa}=qa;
    await guard();
    const mediaReview=await reviewNativeMedia({episode,video:join(dir,"assembled/sequence.mp4"),videoSha256:hash(bytes),directory:dir,
      takes:sources.map((s,i)=>({...s,expected_text:run.draft.scenes[i]!.narration_text}))});
    await guard();
    const receipt={...publicQa,episode_id:episode,fingerprint:run.fingerprint,script_hash:await computeScriptHash(script),policy_hash:hash(Buffer.from(canonicalStringify(policyRows[0]!.value))),quality_policy:policyRows[0]!.value,script_qa:quality,media_review:mediaReview};
    await guard();const video=await put(bytes,"mp4"),savedScript=await put(Buffer.from(JSON.stringify(script)),"json"),savedQa=await put(Buffer.from(JSON.stringify(receipt)),"json");
    return {...video,script_path:savedScript.path,script_sha256:savedScript.sha256,qa_path:savedQa.path,qa_sha256:savedQa.sha256};
  };
 const deadline=Date.now()+35*60_000;
 while(Date.now()<deadline) {
  const pending=await request(`/rest/v1/studio_puter_preparations?episode_id=eq.${episode}&select=cancel_requested`);
  if(!pending.ok)throw new PuterError("cancellation_state_unavailable");
  const cancel=z.array(z.object({cancel_requested:z.boolean()})).length(1).parse(await pending.json())[0]!.cancel_requested;
  const unfinished=state.tasks.find(t=>t.phase!=="ready");
  if(cancel&&(!unfinished||unfinished.phase==="planned"||unfinished.remote_complete)) {
   const result=reply.parse(await rpc("close_puter_chapter",base));await reportFailure(result.code);process.stdout.write(JSON.stringify(result)+"\n");return;
  }
  const result=await advancePuterChapter(state,{
   provider:{inspect,submit:provider.submit.bind(provider),download:provider.download.bind(provider),removeVerifiedCopy:provider.removeVerifiedCopy.bind(provider)},guard,
   save:async(next)=>{await rpc("save_puter_chapter",{...base,p_state:next});state=next;},
   cached:async(path,sha256)=>{try{const b=await privateBytes(path,50*1024*1024);if(hash(b)!==sha256)throw new PuterError("cached_output_changed");return b;}catch(e){if(e instanceof PuterError&&e.code==="private_media_unavailable")return null;throw e;}},
   reference:async(path,sha256)=>{
    if(!state.profile.references.some(r=>r.path===path&&r.sha256===sha256))throw new PuterError("invalid_reference");
    const b=await privateBytes(path,12*1024*1024);if(hash(b)!==sha256)throw new PuterError("reference_changed");
    const m=await sharp(b,{limitInputPixels:20_000_000}).metadata();if(m.format!=="png"||!m.width||!m.height||Math.abs(m.width/m.height-9/16)>.025)throw new PuterError("reference_invalid");return b;
   },
   collect:async(bytes,key)=>{
    await guard();const saved=await put(bytes,"mp4"),file=join(dir,`${key}.mp4`);await writeFile(file,bytes,{mode:0o600});
    const probe=spawnSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",file],{encoding:"utf8",timeout:30000,windowsHide:true});
    if(probe.status!==0)throw new PuterError("native_media_contract_changed");
    const media=JSON.parse(probe.stdout),video=media.streams.filter((s:{codec_type:string})=>s.codec_type==="video"),audio=media.streams.filter((s:{codec_type:string})=>s.codec_type==="audio"),v=video[0];
    if(video.length!==1||audio.length!==1||v.width!==720||v.height!==1280||v.avg_frame_rate!=="30/1"||Number(v.nb_read_frames)<148||Number(v.nb_read_frames)>152||
      !Number.isFinite(Number(v.nb_read_frames))||Math.abs(Number(v.duration)-Number(v.nb_read_frames)/30)>.002||v.codec_name!=="h264"||v.pix_fmt!=="yuv420p")throw new PuterError("native_media_contract_changed");
    const decode=spawnSync("ffmpeg",["-v","error","-xerror","-i",file,"-f","null","-"],{encoding:"utf8",timeout:30000,windowsHide:true});
    if(decode.status!==0)throw new PuterError("native_media_contract_changed");
    return {request_key:key,sha256:saved.sha256,path:saved.path,frames:Number(v.nb_read_frames)};
   },assemble,
   duringSubmit:async(operation)=>{
    // Lease is 15 minutes; synchronous provider request is limited to 10 minutes.
    await guard();return operation();
   },
  });
  process.stdout.write(JSON.stringify({episode_id:episode,...result})+"\n");await reportFailure(result.error_code||result.code);
  if(result.code==="review_pending"&&state.output) {
   const script=await privateBytes(state.output.script_path,1024*1024),qa=await privateBytes(state.output.qa_path,1024*1024);
   if(hash(script)!==state.output.script_sha256||hash(qa)!==state.output.qa_sha256)throw new PuterError("cached_output_changed");
   await rpc("complete_puter_chapter",{...base,p_origin:origin.origin,p_script_text:script.toString("utf8"),p_qa_text:qa.toString("utf8")});
   try{await rpc("save_puter_media_review",{p_episode:episode,p_report:JSON.parse(qa.toString("utf8")).media_review});}catch{process.stdout.write('{"code":"media_review_unavailable","human_review_required":true}\n');}
   return;
  }
  if(result.code==="blocked")return;
  let pause=result.poll_after_seconds*1000;while(pause>0&&Date.now()<deadline){const n=Math.min(30000,pause);await new Promise(r=>setTimeout(r,n));pause-=n;await guard();}
 }
 }finally{await rpc("finish_puter_chapter",base);}
}
try{await main();}catch(e){const code=e instanceof PuterError?e.code:"puter_worker_unavailable";await reportFailure?.(code).catch(()=>{});process.stderr.write(JSON.stringify({code,human_review_required:true})+"\n");process.exitCode=1;}
