import {assertEquals} from "jsr:@std/assert@1";
import type {SupabaseClient} from "npm:@supabase/supabase-js@2";
import {advancePipeline} from "./advance-pipeline.ts";
Deno.test("native chapter ticks dispatch only the frozen episode, independently of the Modal gate",async()=>{
 const keys=["GITHUB_TOKEN","GITHUB_REPO","CONTENT_AI_ANIMATION_PREPARATION_ENABLED"],previous=keys.map(k=>Deno.env.get(k)),original=globalThis.fetch;
 Deno.env.set(keys[0],"fixture-key");Deno.env.set(keys[1],"fixture/repository");Deno.env.delete(keys[2]);
 let allowed=false,calls=0;
 const db={rpc:async(name:string)=>{
  if(name==="studio_next_episode")return {data:[{id:"frozen-episode",status:"research",metadata:{native_chapter:true}}],error:null};
  if(name==="studio_native_step")return {data:{code:allowed?"dispatch":"waiting_for_runner"},error:null};
  throw Error("Unexpected pipeline route");
 }} as unknown as SupabaseClient;
 globalThis.fetch=(async(input,init)=>{assertEquals(String(input),"https://api.github.com/repos/fixture/repository/actions/workflows/story-native.yml/dispatches");assertEquals(JSON.parse(String(init?.body)).inputs,{episode_id:"frozen-episode"});calls++;return new Response(null,{status:204});}) as typeof fetch;
 try{assertEquals((await advancePipeline(db))!.code,"waiting_for_runner");assertEquals(calls,0);allowed=true;assertEquals((await advancePipeline(db))!.code,"dispatch");assertEquals(calls,1);}
 finally{globalThis.fetch=original;keys.forEach((k,i)=>previous[i]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[i]!));}
});
