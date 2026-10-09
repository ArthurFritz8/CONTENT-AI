import {assertEquals} from "jsr:@std/assert@1";
import type {SupabaseClient} from "npm:@supabase/supabase-js@2";
import {advancePipeline} from "./advance-pipeline.ts";

Deno.test("animated pipeline dispatches the trusted job ID and keeps budget failures away from inference",async()=>{
 const names=["CONTENT_AI_VIDEO_DISPATCH_ENABLED","GITHUB_TOKEN","GITHUB_REPO"],previous=names.map(n=>Deno.env.get(n)),original=globalThis.fetch;
 names.forEach((n,i)=>Deno.env.set(n,["true","fixture-key","fixture/repository"][i]!));
 let eligible=false,calls=0;
 const db={rpc:async(name:string)=>{
  if(name==="studio_next_episode")return {data:[{id:"episode",status:"script",script_json:{fiction:{animation:{}}}}],error:null};
  if(name==="mount_animated_chapter")return {data:{code:"waiting_for_clips"},error:null};
  if(name==="studio_animation_step")return {data:eligible ? {code:"dispatch",workflow:"video",target:"existing-job"}:{code:"insufficient_capacity"},error:null};
  throw Error("Unexpected RPC");
 }} as unknown as SupabaseClient;
 globalThis.fetch=(async(input,init)=>{
  assertEquals(String(input),"https://api.github.com/repos/fixture/repository/actions/workflows/story-video.yml/dispatches");
  assertEquals(JSON.parse(String(init!.body)).inputs,{job_id:"existing-job"});calls++;return new Response(null,{status:204});
 }) as typeof fetch;
 try {
  assertEquals((await advancePipeline(db))!.code,"insufficient_capacity");assertEquals(calls,0);
  eligible=true;assertEquals((await advancePipeline(db))!.code,"dispatch");assertEquals(calls,1);
 } finally {globalThis.fetch=original;names.forEach((n,i)=>previous[i]===undefined ? Deno.env.delete(n):Deno.env.set(n,previous[i]!));}
});
