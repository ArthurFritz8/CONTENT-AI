import {assertEquals,assertRejects} from "jsr:@std/assert@1";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {canonicalStringify,sha256Hex} from "../../../packages/core/src/validators/hash-utils.ts";
import {nativeFingerprint,prepareNativeDraft} from "../../../packages/core/src/stories/native-chapter.ts";
import {generateStoryScript} from "./story-script.ts";
import {createServiceClient} from "./supabase-client.ts";
import {JobLogger} from "./logger.ts";
import {NATIVE_PUTER} from "../../../packages/core/src/stories/puter-contract.ts";

Deno.test("local comic refuses an episode without its frozen local choice before any generation",async()=>{
 const keys=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CONTENT_AI_SERVICE_ROLE_KEY"],previous=keys.map(key=>Deno.env.get(key)),original=globalThis.fetch;
 keys.forEach(key=>Deno.env.delete(key));Deno.env.set(keys[0],"https://story.supabase.co");Deno.env.set(keys[1],"test-service");
 let calls=0;globalThis.fetch=(async input=>{const url=new URL(input instanceof Request?input.url:String(input));
  assertEquals(url.pathname,"/rest/v1/rpc/studio_story_local_comic_episode");calls++;return Response.json(false);}) as typeof fetch;
 try {const fixture=nativeFixtureInput(),context={...fixture.context,local_comic:true as const},db=createServiceClient();
  await assertRejects(()=>generateStoryScript(db,new JobLogger(db,"comic-fixture"),{id:fixture.episodeId,briefing:{story_context:context},research_evidence:{type:"fiction_plan",context}}));
  assertEquals(calls,1);
 }finally{globalThis.fetch=original;keys.forEach((key,index)=>previous[index]===undefined?Deno.env.delete(key):Deno.env.set(key,previous[index]!));}
});

for(const provider of ["auray","puter"])for(const shots of (provider==="puter"?[3] as const:[3,6,9] as const))Deno.test(`${provider} writer freezes ${shots} visible dialogues once without video calls`,async()=>{
 const keys=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","CONTENT_AI_SERVICE_ROLE_KEY","GEMINI_API_KEY","OPENROUTER_API_KEY","CONTENT_AI_ANIMATION_PREPARATION_ENABLED"],previous=keys.map(k=>Deno.env.get(k)),original=globalThis.fetch;
 keys.forEach(k=>Deno.env.delete(k));Deno.env.set(keys[0],"https://story.supabase.co");Deno.env.set(keys[1],"test-service");Deno.env.set(keys[3],"test-gemini");
 const a=nativeFixtureInput(shots),profile=provider==="puter"?{...a.profile,version:NATIVE_PUTER.version,model:NATIVE_PUTER.model,contract_sha256:NATIVE_PUTER.contractSha256,width:720,height:1280,output_fps:30}:a.profile;
 const profileHash=await sha256Hex(canonicalStringify(profile)),fingerprint=await nativeFingerprint(prepareNativeDraft(a.draft,a.context,profile),a.context,profile);
 let saved=false,textCalls=0,saves=0;
 const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{"Content-Type":"application/json"}});
 globalThis.fetch=(async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input)),body=init?.body?JSON.parse(String(init.body)):null;
  if(u.pathname.endsWith("/rpc/studio_story_episode_profile"))return json({profile,profile_sha256:profileHash});
  if(u.pathname.endsWith(provider==="puter"?"/studio_puter_preparations":"/studio_native_preparations"))return json(saved?{episode_id:a.episodeId}:null);
  if(u.pathname.endsWith(provider==="puter"?"/rpc/save_puter_draft":"/rpc/save_native_draft")){assertEquals(body.p_profile,profileHash);assertEquals(body.p_fingerprint,fingerprint);assertEquals(body.p_draft.scenes.length,shots);saved=true;saves++;return json({code:"prepared"});}
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
