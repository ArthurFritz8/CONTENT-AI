import {assertEquals,assertRejects} from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {prepareAnimation} from "./animation-preparation-runner.ts";
import {animatedFixtureInput} from "../../../packages/core/src/testing/animated-fixture.ts";
import {preparationFingerprint} from "../../../packages/core/src/stories/animated-preparation.ts";
import {productionProfileHash} from "../../../packages/core/src/stories/production.ts";
import {scriptJsonSchema} from "../../../packages/core/src/schemas/script-json.ts";

const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,"0")).join("");
async function media(seconds:number) {
 const dir=await Deno.makeTempDir({prefix:"story-preparation-test-"});
 try {
  const png=`${dir}/ref.png`,mp3=`${dir}/voice.mp3`;
  for(const args of [["-f","lavfi","-i","color=c=orange:s=704x1280","-frames:v","1",png],
   ["-f","lavfi","-i",`sine=frequency=440:sample_rate=16000:duration=${seconds}`,"-c:a","libmp3lame",mp3]]) {
   const out=await new Deno.Command("ffmpeg",{args:["-y","-v","error",...args],stdout:"null",stderr:"piped"}).output();
   if(!out.success)throw Error("Synthetic audio/reference fixture failed");
  }
  return {png:await Deno.readFile(png),mp3:await Deno.readFile(mp3)};
 } finally {await Deno.remove(dir,{recursive:true});}
}
async function rig(seconds=1) {
 const fixture=animatedFixtureInput(),audio=await media(seconds);
 fixture.profile.references=fixture.profile.references.map(r=>({...r,path:`workspace/${r.character_id}.png`}));
 for(const r of fixture.profile.references)r.sha256=await hash(audio.png);
 fixture.profile.voices=fixture.profile.voices.map((v,i)=>({...v,version:"edge-tts-7.2.8-rate0",voice_id:i ? "pt-BR-AntonioNeural":"pt-BR-FranciscaNeural"}));
 const fingerprint=await preparationFingerprint(fixture.draft,fixture.context,fixture.profile);
 const profileHash=await productionProfileHash(fixture.profile),files=new Map(fixture.profile.references.map(r=>[r.path,audio.png]));
 const checkpoints:Record<string,any>[]=[],syntheses:string[]=[],calls:string[]=[];let failAt=3,completed=0;
 const db={
  rpc:async(name:string,args:Record<string,any>)=>{
   calls.push(name);
   if(name==="claim_animation_preparation")return {data:{code:"claimed",preparation:{workspace_id:"workspace",context:fixture.context,draft:fixture.draft,
    profile_sha256:profileHash,fingerprint},audio:structuredClone(checkpoints)},error:null};
   if(name==="fail_animation_preparation")return {data:{code:"failed",checkpoints_preserved:true},error:null};
   if(name==="save_animation_audio"){checkpoints.push(structuredClone(args.p_binding));return {data:{code:"saved"},error:null};}
   if(name==="complete_animation_preparation"){
    const script=scriptJsonSchema.parse(args.p_script);
    assertEquals(script.scenes.length,5);assertEquals(args.p_quality.passed,true);assertEquals(script.fiction!.animation!.output_fps,60);completed++;
    return {data:{code:"prepared"},error:null};
   }
   throw Error("Unexpected GPU or unrelated RPC");
  },
  from:(table:string)=>{
   if(table==="job_events")return {insert:async()=>({error:null})};
   const query={select:()=>query,eq:()=>query,single:async()=>({data:{profile:fixture.profile,profile_sha256:profileHash},error:null}),
    maybeSingle:async()=>({data:{value:{blocked_patterns:{medical:["\\mcura\\M"]},require_source_per_claim:true}},error:null})};
   if(!["studio_series_production","system_config"].includes(table))throw Error("Unexpected table");return query;
  },
  storage:{from:()=>({download:async(path:string)=>files.has(path) ? {data:new Blob([new Uint8Array(files.get(path)!)]),error:null}:{data:null,error:{message:"missing"}},
   upload:async(path:string,bytes:Uint8Array,options:{upsert:boolean})=>{assertEquals(options.upsert,false);files.set(path,new Uint8Array(bytes));return {error:null};}})},
 } as unknown as SupabaseClient;
 const synthesize:Parameters<typeof prepareAnimation>[2]=async(engine,text,cfg)=>{
  assertEquals(engine,"edge");assertEquals(cfg.edge_rate,"+0%");
  if(syntheses.length+1===failAt){failAt=0;throw Error("Simulated TTS interruption");}
  syntheses.push(text);return {engine:"edge",bytes:audio.mp3,mimeType:"audio/mpeg",extension:"mp3",duration_seconds:seconds,word_boundaries:null};
 };
 return {fixture,files,checkpoints,syntheses,calls,db,synthesize,completed:()=>completed};
}
Deno.test("real PCM preparation resumes only missing dialogue and commits the full bound script without GPU",async()=>{
 const r=await rig();
 await assertRejects(()=>prepareAnimation(r.db,r.fixture.episodeId,r.synthesize));
 assertEquals(r.checkpoints.length,2);assertEquals(r.completed(),0);
 const before=r.syntheses.length;
 assertEquals((await prepareAnimation(r.db,r.fixture.episodeId,r.synthesize)).code,"prepared");
 assertEquals(r.syntheses.length-before,3);assertEquals(r.checkpoints.length,5);assertEquals(r.completed(),1);
 assertEquals(r.checkpoints.every(b=>b.audio_seconds>0 && b.audio_seconds<=3.9375),true);
 assertEquals(r.calls.includes("claim_video_job"),false);
});
Deno.test("actual overlong PCM is rejected before any checkpoint, reservation or time compression",async()=>{
 const r=await rig(4.2);
 await assertRejects(()=>prepareAnimation(r.db,r.fixture.episodeId,r.synthesize));
 assertEquals(r.checkpoints.length,0);assertEquals(r.completed(),0);
});
