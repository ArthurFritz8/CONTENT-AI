import {assertEquals,assertRejects} from "jsr:@std/assert@1";
import {storyFixture} from "../../../packages/core/src/testing/story-fixture.ts";
import {buildStoryScript} from "../../../packages/core/src/stories/script.ts";
import {handleScript} from "../generate-script/handler.ts";
import {handleAssets} from "../generate-assets/handler.ts";
import {writeStory} from "./story-writer.ts";
import {createServiceClient} from "./supabase-client.ts";
import {JobLogger} from "./logger.ts";
const policy={blocked_patterns:{medical:["\\mcura\\M"]},require_source_per_claim:true};
async function envTest(run:()=>Promise<void>) {
 const names=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","GEMINI_API_KEY","OPENROUTER_API_KEY"],previous=names.map(n=>Deno.env.get(n)),fetch=globalThis.fetch;
 Deno.env.set(names[0],"https://story.supabase.co");Deno.env.set(names[1],"test-service-key");Deno.env.set(names[2],"test-gemini-key");Deno.env.delete(names[3]);
 try{await run();}finally{globalThis.fetch=fetch;names.forEach((n,i)=>previous[i]===undefined?Deno.env.delete(n):Deno.env.set(n,previous[i]!));}
}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}});
Deno.test("fiction script and image checkpoints use frozen context; no stock or research API",async()=>await envTest(async()=>{
 const {context,draft}=storyFixture(),id="11111111-1111-4111-8111-111111111111",episode:Record<string,any>={id,status:"research",briefing:{story_context:context},research_data:[],research_evidence:{type:"fiction_plan",context:structuredClone(context)},tts_engine:null};
 const assets:Record<string,any>[]=[];let calls=0;let uploads=0;
 globalThis.fetch=(async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input)),method=init?.method??"GET",body=typeof init?.body==="string"?JSON.parse(init.body):null;
  if(u.hostname==="generativelanguage.googleapis.com"){calls++;return json({candidates:[{content:{parts:[{text:JSON.stringify(draft)}]}}]});}
  if(u.pathname.endsWith("/rpc/claim_episode")||u.pathname.endsWith("/rpc/reserve_gemini_call"))return json(true);
  if(u.pathname.endsWith("/episode_leases"))return new Response(null,{status:204});
  if(u.pathname.endsWith("/episodes")){if(method==="PATCH"){Object.assign(episode,body);return body.status==="script"?json({id}):new Response(null,{status:204});}return json(episode);}
  if(u.pathname.endsWith("/system_config"))return json({value:u.searchParams.get("key")==="eq.fact_check"?policy:{}});
  if(u.pathname.endsWith("/assets")){if(method==="POST"){assets.push(...body);return new Response(null,{status:201});}return json(assets);}
  if(u.pathname.startsWith("/storage/")){uploads++;return json({Key:"own.svg"});}
  if(u.pathname.endsWith("/job_events"))return new Response(null,{status:201});
  throw Error(`Unexpected external request: ${u.hostname} ${u.pathname}`);
 }) as typeof fetch;
 const req=()=>new Request("https://worker.test",{method:"POST",headers:{Authorization:"Bearer test-service-key"},body:JSON.stringify({episode_id:id})});
 assertEquals((await handleScript(req())).status,200);assertEquals(calls,1);assertEquals(episode.status,"script");
 for(let i=0;i<episode.script_json.scenes.length;i++){assertEquals((await handleAssets(req())).status,202);assertEquals(assets.length,(i+1)*4);}
 assertEquals(assets.every(a=>a.license==="own"&&a.source==="system"),true);assertEquals(calls,1);
 assertEquals((await handleAssets(req())).status,202);assertEquals(episode.tts_engine,"edge");const count=uploads;
 episode.script_json.fiction.context.bible.cast[0].color="#abcdef";
 const response=await handleAssets(req());assertEquals(response.status,422);assertEquals(uploads,count);
}));
Deno.test("writer refuses paid/unknown models and pauses on OpenRouter account limits",async()=>await envTest(async()=>{
 Deno.env.delete("GEMINI_API_KEY");Deno.env.set("OPENROUTER_API_KEY","test-router-key");let apiCalls=0,reservations=0;let model="paid/model";
 globalThis.fetch=(async(input)=>{
  const u=new URL(input instanceof Request?input.url:String(input));
  if(u.pathname.endsWith("/system_config"))return json({value:{openrouter_models:[model]}});
  if(u.pathname==="/api/v1/models")return json({data:[{id:"valid/model:free",pricing:{prompt:"0",completion:"0"}}]});
  if(u.pathname.endsWith("/rpc/reserve_story_provider_call")){reservations++;return json(true);}
  if(u.pathname==="/api/v1/chat/completions"){apiCalls++;return json({error:"quota"},429);}
  if(u.pathname.endsWith("/job_events"))return new Response(null,{status:201});
  throw Error(`Unexpected ${u.pathname}`);
 }) as typeof fetch;
 const db=createServiceClient(),logger=new JobLogger(db,"test");
 await assertRejects(()=>writeStory(db,logger,"A story"));assertEquals(apiCalls,0);assertEquals(reservations,0);
 model="valid/model:free";await assertRejects(()=>writeStory(db,logger,"A story"));assertEquals(apiCalls,1);assertEquals(reservations,1);
}));
