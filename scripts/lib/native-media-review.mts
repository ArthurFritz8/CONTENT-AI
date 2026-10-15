import {mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {spawnSync} from "node:child_process";
import {nativeMediaReviewSchema,unavailableNativeMediaReview} from "../../packages/core/src/stories/native-review.ts";
export async function reviewNativeMedia(input:{episode:string;video:string;videoSha256:string;directory:string;takes:Array<{path:string;sha256:string;speaker:string;expected_text:string}>}) {
 const fallback=()=>unavailableNativeMediaReview(input.episode,input.videoSha256,input.takes);
 try {
  await mkdir(input.directory,{recursive:true});const manifest=join(input.directory,"media-review-input.json");
  await writeFile(manifest,JSON.stringify({episode_id:input.episode,video_path:input.video,video_sha256:input.videoSha256,takes:input.takes}),{mode:0o600});
  const command=spawnSync(process.env.PYTHON_EXECUTABLE||"python",["-X","utf8",resolve(import.meta.dirname,"../review_native_media.py"),manifest],{encoding:"utf8",timeout:150000,maxBuffer:1024*1024,windowsHide:true});
  if(command.status!==0)return fallback();
  const r=nativeMediaReviewSchema.parse(JSON.parse(command.stdout));
  if(r.episode_id!==input.episode||r.video_sha256!==input.videoSha256||r.takes.some((t,i)=>t.sha256!==input.takes[i]?.sha256||t.speaker!==input.takes[i]?.speaker||t.expected_text!==input.takes[i]?.expected_text))return fallback();
  return r;
 }catch{return fallback();}
}
