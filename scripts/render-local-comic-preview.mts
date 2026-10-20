import {readFile,writeFile,mkdir,realpath,stat} from "node:fs/promises";
import {resolve,join,relative,isAbsolute} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import sharp from "sharp";
import {z} from "zod";
import {comicPanelArtwork} from "../packages/core/src/stories/art.ts";
import {buildSceneFilterGraph} from "../apps/local-renderer/src/render-utils.ts";
const root=resolve(import.meta.dirname,".."),hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
async function main() {
 const plan=z.object({version:z.literal("1.0.0"),format:z.literal("motion_comic"),source:z.literal("local"),voice_mode:z.literal("reuse_approved_audio"),
  source_path:z.string().min(1),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().min(5).max(100),speech:z.string().min(4).max(120),seconds:z.literal(5)}).strict()
  .parse(JSON.parse(await readFile(resolve(process.argv[2]||"docs/stories/local-comic-preview.json"),"utf8")));
 const source=await realpath(resolve(root,plan.source_path)),inside=relative(join(root,"output"),source);
 if(!inside||inside.startsWith("..")||isAbsolute(inside)||(await stat(source)).size>50*1024*1024)throw Error("invalid_approved_source");
 if(hash(await readFile(source))!==plan.source_sha256)throw Error("approved_audio_source_changed");
 const folder=join(root,"output/local-comic-laranjito-preview"),statePath=join(folder,"state.json");await mkdir(folder,{recursive:true});
 const run=(name:string,args:string[])=>{const result=spawnSync(name,args,{cwd:folder,encoding:"utf8",windowsHide:true,timeout:120000});
  if(result.status!==0)throw Error("local_comic_media_command_failed");return result.stdout;};
 const probe=(path:string)=>JSON.parse(run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",path]));
 const original=probe(source),video=original.streams.find((stream:{codec_type:string})=>stream.codec_type==="video");
 if(!video||video.width!==720||video.height!==1280||Math.abs(Number(video.duration)-plan.seconds)>.05||!original.streams.some((stream:{codec_type:string})=>stream.codec_type==="audio"))throw Error("approved_media_contract_changed");
 const planHash=hash(Buffer.from(JSON.stringify(plan)));
 try {const prior=JSON.parse(await readFile(statePath,"utf8"));if(prior.plan_sha256!==planHash||prior.phase!=="rendered"||hash(await readFile(join(folder,"original.mp4")))!==prior.output_sha256)throw Error("cached_comic_changed");
  console.log(JSON.stringify({code:"cached",path:"output/local-comic-laranjito-preview/original.mp4",external_generation_calls:0}));return;
 }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
 await writeFile(statePath,JSON.stringify({phase:"rendering",plan_sha256:planHash,format:plan.format,voice_mode:plan.voice_mode,external_generation_calls:0},null,2),{flag:"wx"});
 run("ffmpeg",["-nostdin","-v","error","-i",source,"-frames:v","1","reference.png"]);
 const image=await readFile(join(folder,"reference.png")),data=`data:image/png;base64,${image.toString("base64")}`;
 const artwork=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><image href="${data}" width="1080" height="1920"/></svg>`;
 for(const panel of [1,2])await sharp(Buffer.from(comicPanelArtwork(artwork,plan.speech,panel,"portrait"))).resize(720,1280).png().toFile(join(folder,`panel_${panel}.png`));
 await writeFile(join(folder,"captions.srt"),`1\n00:00:00,000 --> 00:00:05,000\n${plan.speech}\n`,"utf8");
 const filters=buildSceneFilterGraph({shotDurations:[2.5,2.5],motion:"pan_left",size:{width:720,height:1280},subtitlePath:"captions.srt",audioDuration:5,gapSeconds:0});
 run("ffmpeg",["-nostdin","-v","error","-loop","1","-i","panel_1.png","-loop","1","-i","panel_2.png","-i",source,
  "-filter_complex_threads","1","-filter_complex",filters,"-map","[v]","-map","[a]","-c:v","libx264","-threads","2","-preset","fast","-crf","18",
  "-pix_fmt","yuv420p","-r","30","-c:a","aac","-b:a","192k","-ar","44100","-t","5","-movflags","+faststart","original.mp4"]);
 run("ffmpeg",["-nostdin","-v","error","-xerror","-i","original.mp4","-f","null","-"]);
 const output=probe("original.mp4"),rendered=output.streams.find((stream:{codec_type:string})=>stream.codec_type==="video");
 if(!rendered||rendered.width!==720||rendered.height!==1280||rendered.avg_frame_rate!=="30/1"||Math.abs(Number(rendered.duration)-5)>.05||
  !output.streams.some((stream:{codec_type:string})=>stream.codec_type==="audio"))throw Error("comic_output_contract_failed");
 const bytes=await readFile(join(folder,"original.mp4"));
 await writeFile(statePath,JSON.stringify({phase:"rendered",plan_sha256:planHash,source_sha256:plan.source_sha256,output_sha256:hash(bytes),bytes:bytes.length,
  format:"motion_comic",source:"local",voice_mode:plan.voice_mode,seconds:5,width:720,height:1280,fps:30,panels:2,external_generation_calls:0,
  body_animation:false,lip_sync:false,human_review_required:true},null,2)+"\n");
 run("ffmpeg",["-nostdin","-v","error","-i","original.mp4","-vf","fps=1,scale=240:-1,tile=5x1","-frames:v","1","-update","1","contact-sheet.jpg"]);
 console.log(JSON.stringify({code:"rendered",path:"output/local-comic-laranjito-preview/original.mp4",sha256:hash(bytes),bytes:bytes.length,seconds:5,fps:30,
  voice_mode:plan.voice_mode,external_generation_calls:0,body_animation:false,human_review_required:true}));
}
main().catch(()=>{console.error("local_comic_render_failed_no_external_generation");process.exitCode=1;});