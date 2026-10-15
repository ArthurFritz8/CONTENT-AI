/** Audit only: GET existing private bytes, then save advisory report. No provider SDK calls. */
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {validateNativeRun} from "../apps/local-renderer/src/auray-native-chapter.ts";
import {reviewNativeMedia} from "./lib/native-media-review.mts";
const values:Record<string,string>={};
for(const l of (await readFile(resolve(import.meta.dirname,"../.env.cloud"),"utf8")).split(/\r?\n/)) {const m=l.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(m)values[m[1]!]=m[2]!.trim().replace(/^(['"])(.*)\1$/,"$2");}
const cfg={...values,...process.env},origin=new URL(cfg.SUPABASE_URL||""),service=cfg.CONTENT_AI_SERVICE_ROLE_KEY||cfg.SUPABASE_SERVICE_ROLE_KEY;
if(!service||origin.protocol!=="https:"||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname))throw Error("Invalid Studio configuration");
const episode=z.string().uuid().parse(process.argv[2]),localOnly=process.argv.includes("--local-only"),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function request(path:string,payload?:unknown) {
 const r=await fetch(origin.origin+path,{method:payload===undefined?"GET":"POST",headers:{apikey:service!,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:payload===undefined?undefined:JSON.stringify(payload),redirect:"error",signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error("Private audit request failed");return r;
}
try {
 const rows=await (await request(`/rest/v1/studio_native_runs?episode_id=eq.${episode}&select=state`)).json();
 const state=await validateNativeRun(rows[0]?.state);if(!state.output)throw Error("No completed native film");
 const dir=resolve(import.meta.dirname,"../output/native-chapters",episode,"media-review");await mkdir(dir,{recursive:true});
 const download=async(path:string,sha256:string,name:string)=>{
  if(!path.startsWith(`episodes/${episode}/native/`)||path.includes("..")||!/^[a-zA-Z0-9_./-]+$/.test(path))throw Error("Invalid media path");
  const res=await request('/storage/v1/object/studio-private/'+path),chunks:Uint8Array[]=[];let size=0;
  for await(const part of res.body!){size+=part.length;if(size>50*1024*1024)throw Error("Media too large");chunks.push(part);}
  const bytes=Buffer.concat(chunks);if(hash(bytes)!==sha256)throw Error("Media changed");const file=join(dir,name);await writeFile(file,bytes,{mode:0o600});return file;
 };
 const video=await download(state.output.path,state.output.sha256,"chapter.mp4"),takes=[];
 for(const [i,t] of state.tasks.entries())takes.push({path:await download(t.clip!.path,t.clip!.sha256,`take-${i}.mp4`),sha256:t.clip!.sha256,speaker:state.draft.scenes[i]!.visual.speaker_id,expected_text:state.draft.scenes[i]!.narration_text});
 const report=await reviewNativeMedia({episode,video,videoSha256:state.output.sha256,directory:dir,takes});
 await writeFile(join(dir,"report.json"),JSON.stringify(report,null,2),{mode:0o600});
 if(!localOnly)await request('/rest/v1/rpc/save_native_media_review',{p_episode:episode,p_report:report});
 console.log(JSON.stringify({code:localOnly?"local_review_ready":"media_review_saved",episode_id:episode,new_video_credits:0,takes:report.takes.map(t=>({scene:t.index+1,speech:t.speech_status,appearance:t.appearance_status,color_shift_score:t.color_shift_score}))}));
}catch{console.error('{"code":"media_review_unavailable","new_video_credits":0}');process.exitCode=1;}
