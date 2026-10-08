import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleVideoWorker } from "../studio-video-worker/handler.ts";

const id="11111111-1111-4111-8111-111111111111", capability="a".repeat(64);
const request=(body: unknown, token=capability)=>new Request("https://worker.test",{method:"POST",headers:{"x-video-worker-capability":token},body:JSON.stringify(body)});
const blob=new Blob(["fixture-video"]);
const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
const complete={action:"complete",job_id:id,report:{execution_sha256:"b".repeat(64),reference_sha256:"c".repeat(64),input_audio_sha256:"d".repeat(64),
  audio_conditioned:true,lip_sync_validated:false,human_review_required:true,native_fps:16,native_frames:64,output_fps:60,output_frames:237,
  width:704,height:1280,input_audio_seconds:2,no_loop_no_speed_change:true,raw_native_rgb_sha256:"e".repeat(64)},
  manifests:{native:{kind:"manifest",name:"native",size:blob.size,sha256:hash},fluid:{kind:"manifest",name:"fluid",size:blob.size,sha256:hash}}};
function fixture(options: {expired?:boolean; missing?:boolean; mismatch?:boolean}={}) {
  const rpcs: Array<{name:string;args:Record<string,unknown>}>=[],downloads:string[]=[],filters:Record<string,unknown>={};
  const chain={select:()=>chain,eq:(k:string,v:unknown)=>{filters[k]=v;return chain;},maybeSingle:async()=>({data:options.missing ? null : {
    bucket:"studio-private",output_prefix:"workspace/videos/job",expires_at:new Date(Date.now()+(options.expired ? -60000 : 60000)).toISOString(),started_at:new Date().toISOString()},error:null})};
  const db={from:()=>chain,rpc:async(name:string,args:Record<string,unknown>)=>{rpcs.push({name,args});return {data:{code:name==="begin_video_worker" ? "started":"saved"},error:null};},
    storage:{from:()=>({download:async(path:string)=>{downloads.push(path);return {data:options.mismatch ? new Blob(["altered"]):blob,error:null};}})}} as unknown as SupabaseClient;
  return {client:()=>db,rpcs,downloads,filters};
}
Deno.test("worker rejects invalid capability before constructing privileged client",async()=>{
  let accessed=false;
  const res=await handleVideoWorker(request({action:"begin",job_id:id,external_id:"fc-test"},"wrong"),()=>{accessed=true;throw Error("unexpected");});
  assertEquals(res.status,401);assertEquals(accessed,false);
});
Deno.test("worker bounds streamed body before reading database",async()=>{
  let accessed=false;
  const req=new Request("https://worker.test",{method:"POST",headers:{"x-video-worker-capability":capability},body:"x".repeat(30001)});
  const res=await handleVideoWorker(req,()=>{accessed=true;throw Error("unexpected");});
  assertEquals(res.status,413);assertEquals(accessed,false);
});
Deno.test("expired or foreign capability cannot read output objects or invoke lifecycle",async()=>{
  for(const options of [{expired:true},{missing:true}]) {
    const f=fixture(options),res=await handleVideoWorker(request(complete),f.client);
    assertEquals(res.status,401);assertEquals(f.rpcs.length,0);assertEquals(f.downloads.length,0);
  }
});
Deno.test("worker begin hashes capability and uses only job-scoped RPC",async()=>{
  const f=fixture(),res=await handleVideoWorker(request({action:"begin",job_id:id,external_id:"fc-test"}),f.client);
  assertEquals(res.status,200);assertEquals(f.rpcs[0].name,"begin_video_worker");
  assertEquals(f.rpcs[0].args.p_capability===capability,false);
  assertEquals(f.rpcs[0].args.p_capability,f.filters.capability_sha256);
});
Deno.test("completion validates both private stored objects before recording completion",async()=>{
  const f=fixture(),res=await handleVideoWorker(request(complete),f.client);
  assertEquals(res.status,200);assertEquals(f.downloads,["workspace/videos/job/native.mp4","workspace/videos/job/fluid.mp4"]);
  assertEquals(f.rpcs[0].name,"complete_video_worker");assertEquals(f.rpcs[0].args.p_recovery,undefined);
});
Deno.test("corrupt stored object never marks completed",async()=>{
  const f=fixture({mismatch:true}),res=await handleVideoWorker(request(complete),f.client);
  assertEquals(res.status,422);assertEquals(f.rpcs.length,0);
});
Deno.test("public worker callback cannot enable late privileged recovery or claim human sync review",async()=>{
  for(const bad of [{...complete,p_recovery:true},{...complete,report:{...complete.report,lip_sync_validated:true}}]) {
    const f=fixture(),res=await handleVideoWorker(request(bad),f.client);
    assertEquals(res.status,400);assertEquals(f.rpcs.length,0);
  }
});
