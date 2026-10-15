import {assertEquals} from "jsr:@std/assert@1";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {canonicalStringify,sha256Hex} from "../../../packages/core/src/validators/hash-utils.ts";
import {nativeFingerprint,prepareNativeDraft} from "../../../packages/core/src/stories/native-chapter.ts";
import {generateStoryScript} from "./story-script.ts";
import {createServiceClient} from "./supabase-client.ts";
import {JobLogger} from "./logger.ts";

Deno.test("native writer freezes three visible dialogues once and never calls audio, animation or paid video",async()=>{
 const keys=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CONTENT_AI_SERVICE_ROLE_KEY","GEMINI_API_KEY","OPENROUTER_API_KEY","CONTENT_AI_ANIMATION_PREPARATION_ENABLED"],previous=keys.map(k=>Deno.env.get(k)),original=globalThis.fetch;
 keys.forEach(k=>Deno.env.delete(k));Deno.env.set(keys[0],"https://story.supabase.co");Deno.env.set(keys[1],"test-service");Deno.env.set(keys[3],"test-gemini");
 const a=nativeFixtureInput(),profileHash=await sha256Hex(canonicalStringify(a.profile)),fingerprint=await nativeFingerprint(prepareNativeDraft(a.draft,a.context,a.profile),a.context,a.profile);
 let saved=false,textCalls=0,saves=0;
 const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{"Content-Type":"application/json"}});
 globalThis.fetch=(async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input)),body=init?.body?JSON.parse(String(init.body)):null;
  if(u.pathname.endsWith("/rpc/studio_story_episode_profile"))return json({profile:a.profile,profile_sha256:profileHash});
  if(u.pathname.endsWith("/studio_native_preparations"))return json(saved?{episode_id:a.episodeId}:null);
  if(u.pathname.endsWith("/rpc/save_native_draft")){assertEquals(body.p_profile,profileHash);assertEquals(body.p_fingerprint,fingerprint);assertEquals(body.p_draft.scenes.length,3);saved=true;saves++;return json({code:"prepared"});}
  if(u.pathname.endsWith("/system_config"))return json({value:{}});
  if(u.pathname.endsWith("/rpc/reserve_gemini_call"))return json(true);
  if(u.hostname==="generativelanguage.googleapis.com"){textCalls++;return json({candidates:[{content:{parts:[{text:JSON.stringify(a.draft)}]}}]});}
  if(u.pathname.endsWith("/job_events"))return new Response(null,{status:201});
  throw Error("Unexpected native production request: "+u.pathname);
 }) as typeof fetch;
 try{
  const db=createServiceClient(),logger=new JobLogger(db,"native-fixture"),episode={id:a.episodeId,briefing:{story_context:a.context},research_evidence:{type:"fiction_plan",context:a.context}};
  assertEquals((await generateStoryScript(db,logger,episode)).status,200);assertEquals((await generateStoryScript(db,logger,episode)).status,200);
  assertEquals(textCalls,1);assertEquals(saves,1);
 }finally{globalThis.fetch=original;keys.forEach((k,i)=>previous[i]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[i]!));}
});
