/** Cloud worker for an already admitted native chapter; never accepts an arbitrary prompt. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import sharp from "sharp";
import {z} from "zod";
import {AurayVideoProvider,AurayError,AURAY,aurayDefiniteRejections} from "../apps/local-renderer/src/auray-video-provider.ts";
import {advanceNativeChapter,validateNativeRun,type NativeRun,type NativeClip} from "../apps/local-renderer/src/auray-native-chapter.ts";
import {admitNativeChapter} from "../apps/local-renderer/src/auray-native-admission.ts";
import {readAurayStudioBytes,aurayStudioRpcResult} from "../apps/local-renderer/src/auray-studio-sync.ts";
import {verifyAurayMedia} from "../apps/local-renderer/src/auray-media.ts";
import {buildNativeScript} from "../packages/core/src/stories/native-chapter.ts";
import {computeScriptHash,canonicalStringify} from "../packages/core/src/validators/hash-utils.ts";
import {createScriptQualityChecker} from "../packages/core/src/validators/script-quality.ts";
import {reviewNativeMedia} from "./lib/native-media-review.mts";
import {nativeMediaReviewSchema} from "../packages/core/src/stories/native-review.ts";

const root=resolve(import.meta.dirname,".."),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function settings() {
  const values:Record<string,string>={};
  try {for(const line of (await readFile(join(root,".env.cloud"),"utf8")).split(/\r?\n/)) {
    const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if(m)values[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,"$2");
  }}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new AurayError("credential_file_unavailable");}
  return {...values,...process.env};
}
let reportFailure:((code:string)=>Promise<unknown>)|undefined;
async function main() {
  const cfg=await settings(),origin=new URL(cfg.SUPABASE_URL||"");
  if(origin.protocol!=="https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname) || origin.username || origin.password || origin.port || origin.pathname!=="/")throw new AurayError("invalid_studio_url");
  const service=cfg.CONTENT_AI_SERVICE_ROLE_KEY||cfg.SUPABASE_SERVICE_ROLE_KEY;
  if(!service || !cfg.AURAY_API_KEY)throw new AurayError("missing_credentials");
  const headers={apikey:service,Authorization:`Bearer ${service}`};
  const request=(path:string,init:RequestInit={})=>fetch(origin.origin+path,{...init,headers:{...headers,...init.headers},redirect:"error",signal:AbortSignal.timeout(25000)});
  const rpc=async(name:string,args:Record<string,unknown>)=>aurayStudioRpcResult(await request(`/rest/v1/rpc/${name}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args)}));
  const episodeInput=process.env.NATIVE_EPISODE_ID||process.argv[2];
  if(!episodeInput) {
    const pending=z.array(z.string().uuid()).max(3).parse(await rpc("native_recovery_episodes",{}));
    for(const id of pending) {
      const child=spawnSync(process.execPath,["--experimental-strip-types",resolve(import.meta.filename),id],{env:{...process.env,NATIVE_EPISODE_ID:id},stdio:"inherit",timeout:36*60_000,windowsHide:true});
      if(child.status!==0)process.exitCode=1;
    }
    return;
  }
  const episode=z.string().uuid().parse(episodeInput);
  reportFailure=code=>rpc("native_worker_result",{p_episode:episode,p_code:code});
  const provider=new AurayVideoProvider(cfg.AURAY_API_KEY);
  const admission=await admitNativeChapter(episode,{rpc,inspect:()=>provider.inspect()});
  if(admission.code!=="existing"){await reportFailure(admission.code);process.stdout.write(JSON.stringify(admission)+"\n");return;}
  const token=randomUUID(),base={p_episode:episode,p_token:token};
  const claim=z.discriminatedUnion("code",[z.object({code:z.literal("closed")}),z.object({code:z.literal("waiting")}),z.object({code:z.literal("claimed"),state:z.unknown()})]).parse(await rpc("claim_native_chapter",base));
  if(claim.code==="closed")return;
  if(claim.code==="waiting"){process.stdout.write('{"code":"waiting_for_account"}\n');return;}
  try {
  const dir=join(root,"output/native-chapters",episode);await mkdir(dir,{recursive:true});
  let state=await validateNativeRun(claim.state);
  const privateBytes=async(path:string,maximum:number)=>{
    if(!/^[a-zA-Z0-9_./-]+$/.test(path) || path.includes(".."))throw new AurayError("invalid_private_path");
    const r=await request(`/storage/v1/object/studio-private/${path}`);if(!r.ok)throw new AurayError("private_media_unavailable");
    return readAurayStudioBytes(r,maximum);
  };
  const put=async(bytes:Uint8Array,extension:"mp4"|"json")=>{
    if(!bytes.length || bytes.length>50*1024*1024)throw new AurayError("private_storage_size_limit");
    const sha256=hash(bytes),path=`episodes/${episode}/native/${sha256}.${extension}`;
    const r=await request(`/storage/v1/object/studio-private/${path}`,{method:"POST",headers:{"Content-Type":extension==="mp4"?"video/mp4":"application/json","x-upsert":"false"},body:new Uint8Array(bytes)}).catch(()=>null);
    if(!r?.ok && hash(await privateBytes(path,50*1024*1024))!==sha256)throw new AurayError("storage_upload_unresolved");
    return {path,sha256,bytes:bytes.length};
  };
  const guard=async(submission=false)=>{await rpc("guard_native_chapter",{...base,p_submission:submission});};
  const assemble=async(run:NativeRun)=>{
    const sources:Array<{path:string;sha256:string;speaker:string}>=[];
    for(const [i,t] of run.tasks.entries()) {
      if(!t.clip)throw new AurayError("native_clips_incomplete");
      const bytes=await privateBytes(t.clip.path,50*1024*1024);if(hash(bytes)!==t.clip.sha256)throw new AurayError("cached_output_changed");
      const file=join(dir,`take-${i}.mp4`);await writeFile(file,bytes,{mode:0o600});
      sources.push({path:file,sha256:t.clip.sha256,speaker:run.draft.scenes[i]!.visual.speaker_id});
    }
    await guard();const input=join(dir,"sources.json");await writeFile(input,JSON.stringify(sources),{mode:0o600});
    const assembled=spawnSync(process.env.PYTHON_EXECUTABLE||"python",["-X","utf8",join(root,"scripts/assemble_auray_sequence.py"),input,join(dir,"assembled")],{encoding:"utf8",timeout:180000,maxBuffer:1024*1024,windowsHide:true});
    if(assembled.status!==0)throw new AurayError("native_assembly_failed");
    let qa;
    try {qa=JSON.parse(assembled.stdout);}catch{throw new AurayError("native_assembly_invalid");}
    const frames=run.tasks.reduce((n,t)=>n+t.clip!.frames,0);
    if(qa.width!==768 || qa.height!==1344 || qa.encoded_fps!==24 || qa.frames!==frames || Math.abs(qa.seconds-frames/24)>1e-9 ||
      qa.all_decoded_frames_pixel_identical!==true || qa.video_reencoded!==false || qa.decode_verified!==true || qa.audio_encoded_once_from_native_pcm!==true ||
      qa.human_review_required!==true || qa.voice_continuity_approved!==false || qa.production_ready!==false || !Array.isArray(qa.cuts) || qa.cuts.length!==3 ||
      qa.cuts.some((cut:Record<string,any>,i:number)=>cut.speaker!==sources[i]!.speaker || cut.source_sha256!==sources[i]!.sha256 || cut.frames!==run.tasks[i]!.clip!.frames ||
        cut.original_audio!==true || cut.audio_transport?.silent_reference || !Number.isFinite(cut.audio_transport?.correlation) || cut.audio_transport.correlation<.90 ||
        !Number.isFinite(cut.audio_transport?.measured_lag_seconds) || Math.abs(cut.audio_transport.measured_lag_seconds)>.02))throw new AurayError("native_assembly_invalid");
    const bytes=await readFile(join(dir,"assembled/sequence.mp4"));if(hash(bytes)!==qa.sha256)throw new AurayError("cached_output_changed");
    const script=await buildNativeScript({episode,context:run.context,profile:run.profile,draft:run.draft,clips:run.tasks.map(t=>t.clip!),origin:origin.origin});
    const qualityResponse=await request("/rest/v1/system_config?key=eq.fact_check&select=value");
    if(!qualityResponse.ok)throw new AurayError("quality_policy_unavailable");
    const policyRows=z.array(z.object({value:z.unknown()})).length(1).parse(await qualityResponse.json());
    const quality=createScriptQualityChecker(policyRows[0]!.value)(script,[],false);
    if(!quality.passed)throw new AurayError("native_script_quality_failed");
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
    // The workflow is bounded; a later dispatch resumes exactly the saved tasks.
    const deadline=Date.now()+35*60_000;
    while(Date.now()<deadline) {
      if(await rpc("native_cancellation_pending",base)===true) {
        if(state.not_before&&Date.parse(state.not_before)>Date.now()){await reportFailure("cancellation_pending");return;}
        const jobs=[];
        for(const task of state.tasks.filter(t=>t.phase!=="planned")) {
          if(task.phase==="rejected" && aurayDefiniteRejections.some(code=>code===task.error_code)) {jobs.push({id:task.job_id,status:"rejected",settled:true,credits_charged:0,no_acceptance:true});continue;}
          try{const j=await provider.status(task.job_id);jobs.push({id:j.id,status:j.status,settled:j.settled,credits_charged:j.credits_charged});}
          catch{await reportFailure("cancellation_pending");process.stdout.write('{"code":"cancellation_pending"}\n');return;}
        }
        const inspected=await provider.inspect();
        const closed=z.object({code:z.string()}).parse(await rpc("close_native_chapter",{...base,p_proof:{jobs,account_id:inspected.account_id,key_id:inspected.key_id,checked_at:inspected.checked_at,period:inspected.period,plan_remaining:inspected.plan_remaining,key_remaining:inspected.key_remaining,trustworthy:inspected.blockers.every(b=>b==="insufficient_free_credits")}}));
        await reportFailure(closed.code);process.stdout.write(JSON.stringify(closed)+"\n");return;
      }
      const result=await advanceNativeChapter(state,{provider,guard,
        save:async(next)=>{await rpc("save_native_chapter",{...base,p_state:next});state=next;},
        reference:async(path,sha256)=>{
          if(!state.profile.references.some(r=>r.path===path && r.sha256===sha256))throw new AurayError("invalid_reference");
          const b=await privateBytes(path,AURAY.maxImageBytes);if(hash(b)!==sha256)throw new AurayError("reference_changed");
          const m=await sharp(b,{limitInputPixels:20_000_000}).metadata();
          if(m.format!=="png" || !m.width || !m.height || Math.abs(m.width/m.height-9/16)>.025)throw new AurayError("reference_invalid");return b;
        },
        collect:async(job,shot):Promise<NativeClip>=>{
          const bytes=await provider.download(job),file=join(dir,`${job}.mp4`);await writeFile(file,bytes,{mode:0o600});
          const qa=await verifyAurayMedia(file,shot);
          const probe=spawnSync("ffprobe",["-v","error","-show_streams","-of","json",file],{encoding:"utf8",timeout:30000,windowsHide:true});
          if(probe.status!==0)throw new AurayError("media_probe_failed");
          const media=JSON.parse(probe.stdout),video=media.streams.filter((s:{codec_type:string})=>s.codec_type==="video"),audio=media.streams.filter((s:{codec_type:string})=>s.codec_type==="audio");
          if(qa.width!==768 || qa.height!==1344 || qa.encoded_fps!==24 || qa.decoded_frames<116 || qa.decoded_frames>124 ||
            Math.abs(qa.seconds-qa.decoded_frames/24)>.002 || video.length!==1 || audio.length!==1 || video[0].codec_name!=="h264" || video[0].pix_fmt!=="yuv420p")throw new AurayError("native_media_contract_changed");
          await guard();const saved=await put(bytes,"mp4");return {request_key:job.slice(6),sha256:saved.sha256,path:saved.path,frames:qa.decoded_frames};
        },assemble,
      });
      process.stdout.write(JSON.stringify({episode_id:episode,...result})+"\n");
      await reportFailure(result.error_code||result.code);
      if(result.code==="review_pending" && state.output) {
        const scriptBytes=await privateBytes(state.output.script_path,1024*1024),qaBytes=await privateBytes(state.output.qa_path,1024*1024);
        if(hash(scriptBytes)!==state.output.script_sha256 || hash(qaBytes)!==state.output.qa_sha256)throw new AurayError("cached_output_changed");
        const mounted=z.object({code:z.literal("saved")}).parse(await rpc("complete_native_chapter",{...base,p_origin:origin.origin,p_script_text:scriptBytes.toString("utf8"),p_qa_text:qaBytes.toString("utf8")}));
        process.stdout.write(JSON.stringify({code:mounted.code,human_review_required:true})+"\n");
        const review=nativeMediaReviewSchema.safeParse(JSON.parse(qaBytes.toString("utf8")).media_review);
        if(review.success) {
          try{await rpc("save_native_media_review",{p_episode:episode,p_report:review.data});}
          catch{process.stdout.write('{"code":"media_review_unavailable","human_review_required":true}\n');}
        }
      }
      if(result.code==="blocked" || result.code==="review_pending")return;
      let pause=Math.max(0,result.poll_after_seconds*1000);
      // Heartbeats are bounded and share the monitor's account lock.
      while(pause>0 && Date.now()<deadline) {const duration=Math.min(30000,pause,Math.max(0,deadline-Date.now()));await new Promise(r=>setTimeout(r,duration));pause-=duration;await guard();}
    }
    process.stdout.write('{"code":"paused_for_next_dispatch"}\n');
  } finally {await rpc("finish_native_chapter",base);}
}
try{await main();}catch(e){const code=e instanceof AurayError?e.code:"native_worker_unavailable";await reportFailure?.(code).catch(()=>{});process.stderr.write(JSON.stringify({code,human_review_required:true})+"\n");process.exitCode=1;}
