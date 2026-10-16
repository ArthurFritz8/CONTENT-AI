import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {PuterVideoProvider,PuterError,puterCurrentFree,puterRequestKey,puterFilename} from "./puter-video-provider.ts";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {nativeShot,nativeFingerprint} from "../../../packages/core/src/stories/native-chapter.ts";
import {NATIVE_PUTER} from "../../../packages/core/src/stories/puter-contract.ts";
import {puterProfileSchema} from "../../../packages/core/src/stories/native-contract.ts";

const clock=()=>new Date("2026-10-16T18:00:00Z"),access="fixture-only-not-a-real-token";
const identity={uuid:"11111111-2222-4333-8444-555555555555",username:"fixture",email:"private@example.invalid",subscribed:false,subscription:null,is_temp:false,email_confirmed:true,requires_email_confirmation:false,requires_phone_verification:false,requires_card_verification:false,card_fallback_available:false};
const usage={allowanceInfo:{remaining:1000,unit:"credits",monthUsageAllowance:1000,addons:{}}};
const model={id:NATIVE_PUTER.model,provider:NATIVE_PUTER.upstream,costs_currency:"usd-cents",costs:{"per-second":2},durationSeconds:[5],fps:[30],dimensions:["720P"],ratios:["9:16"],keyframes:["first"]};
function fixture(overrides:{identity?:unknown;usage?:unknown;model?:unknown;space?:unknown;generate?:()=>Response|Promise<Response>}={}) {
 const calls:Array<{url:string;init:RequestInit|undefined;body:any}>=[];
 const fetchImpl=(async(url:URL|RequestInfo,init?:RequestInit)=>{
  assert.equal(init?.redirect,"error");assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${access}`);
  const u=new URL(String(url)),body=init?.body?JSON.parse(String(init.body)):null;
  assert.equal(u.origin,"https://api.puter.com");calls.push({url:String(url),init,body});
  if(u.pathname==="/whoami")return Response.json(overrides.identity??identity);
  if(u.pathname==="/metering/usage")return Response.json(overrides.usage??usage);
  if(u.pathname==="/df")return Response.json(overrides.space??{capacity:25*1024*1024,used:5*1024*1024});
  if(u.pathname==="/read")return new Response(Buffer.concat([Buffer.from([0,0,0,32]),Buffer.from("ftyp"),Buffer.alloc(64)]));
  if(u.pathname==="/delete")return Response.json({});
  assert.equal(u.pathname,"/drivers/call");
  if(body.method==="models")return Response.json({success:true,result:[overrides.model??model]});
  assert.equal(body.method,"generate");
  return overrides.generate?overrides.generate():Response.json({success:true,result:"https://never-followed.example.invalid/signed-private-result"});
 }) as typeof fetch;
 return {calls,provider:new PuterVideoProvider(access,{fetchImpl,now:clock})};
}
async function shot() {
 const a=nativeFixtureInput(),image=Buffer.from("fake-png-identity"),imageHash=createHash("sha256").update(image).digest("hex");
 const profile=puterProfileSchema.parse({...a.profile,version:NATIVE_PUTER.version,model:NATIVE_PUTER.model,contract_sha256:NATIVE_PUTER.contractSha256,width:720,height:1280,output_fps:30});
 profile.references[0]!.sha256=imageHash;
 return {image,shot:nativeShot(a.draft,a.context,profile,a.episodeId,await nativeFingerprint(a.draft,a.context,profile),0)};
}
test("free recurring account inspection omits credentials and raw identity",async()=>{
 const f=fixture(),r=await f.provider.inspect();
 assert.equal(r.financially_eligible,true);assert.equal(r.remaining_credits,1000);assert.equal(r.contract_sha256,NATIVE_PUTER.contractSha256);
 assert.equal(puterCurrentFree(r,undefined,clock().getTime()),true);
 const text=JSON.stringify(r);for(const secret of [access,identity.uuid,identity.username,identity.email])assert.equal(text.includes(secret),false);
 assert.equal(f.calls.filter(c=>c.body?.method==="generate").length,0);
});
test("paid, anonymous, card and purchased-credit states never authorize a new render",async()=>{
 for(const change of [{subscribed:true},{card_fallback_available:true},{is_temp:true},{email_confirmed:false},{subscription:{id:"paid"}}]) {
  const r=await fixture({identity:{...identity,...change}}).provider.inspect();assert.equal(r.financially_eligible,false);assert.equal(puterCurrentFree(r,undefined,clock().getTime()),false);
 }
 for(const change of [{unit:"usd"},{monthUsageAllowance:2000},{remaining:1200},{addons:{purchasedCredits:20}}]) {
  const r=await fixture({usage:{allowanceInfo:{...usage.allowanceInfo,...change}}}).provider.inspect();assert.equal(r.financially_eligible,false);
 }
});
test("changed model rates/FPS and stale observations are blocked",async()=>{
 for(const change of [{fps:[24]},{costs:{"per-second":3}},{keyframes:[]},{ratios:["16:9"]}]) {
  const r=await fixture({model:{...model,...change}}).provider.inspect();assert.equal(r.contract_sha256,null);
 }
 const r=await fixture().provider.inspect();assert.equal(puterCurrentFree(r,undefined,clock().getTime()+120001),false);
 assert.equal(puterCurrentFree(r,"a".repeat(64),clock().getTime()),false);
});
test("one pinned real POST uses original reference and private output; vendor URL is discarded",async()=>{
 const f=fixture(),r=await f.provider.inspect(),s=await shot(),key=await puterRequestKey(s.shot,r.account_sha256);
 assert.equal(await f.provider.submit(s.shot,s.image,key,r),puterFilename(key));
 const generated=f.calls.filter(c=>c.body?.method==="generate");assert.equal(generated.length,1);
 const b=generated[0]!.body;assert.equal(b.test_mode,false);assert.equal(b.args.model,NATIVE_PUTER.model);assert.equal(b.args.fps,30);assert.equal(b.args.generate_audio,true);
 assert.equal(b.args.puter_output_path,`~/${puterFilename(key)}`);assert.ok(b.args.input_reference.endsWith(s.image.toString("base64")));
 const bytes=await f.provider.download(key,r.account_sha256);assert.equal(bytes.subarray(4,8).toString(),"ftyp");
 assert.ok(f.calls.every(c=>new URL(c.url).origin==="https://api.puter.com"));
});
test("lost POST and HTTP errors remain unknown and are never retried",async()=>{
 for(const generate of [()=>{throw new Error(`network ${access}`);},()=>new Response("private error",{status:402}),()=>Response.json({success:false})]) {
  const f=fixture({generate}),r=await f.provider.inspect(),s=await shot(),key=await puterRequestKey(s.shot,r.account_sha256);
  await assert.rejects(f.provider.submit(s.shot,s.image,key,r),e=>e instanceof PuterError&&e.acceptance==="unknown"&&!e.message.includes(access));
  assert.equal(f.calls.filter(c=>c.body?.method==="generate").length,1);
 }
});
test("changed reference or request identity never sends a generation",async()=>{
 const f=fixture(),r=await f.provider.inspect(),s=await shot(),key=await puterRequestKey(s.shot,r.account_sha256);
 await assert.rejects(f.provider.submit(s.shot,Buffer.from("changed"),key,r));
 await assert.rejects(f.provider.submit(s.shot,s.image,"a".repeat(64),r));
 assert.equal(f.calls.filter(c=>c.body?.method==="generate").length,0);
});
test("storage exhaustion blocks submission and cleanup only targets an exact verified generated file",async()=>{
 const small=await fixture({space:{capacity:25*1024*1024,used:24*1024*1024}}).provider.inspect();
 assert.equal(small.financially_eligible,false);assert.ok(small.blockers.includes("storage_capacity_unavailable"));
 const f=fixture(),r=await f.provider.inspect(),key="a".repeat(64),bytes=await f.provider.download(key,r.account_sha256),hash=createHash("sha256").update(bytes).digest("hex");
 await assert.rejects(f.provider.removeVerifiedCopy(key,r.account_sha256,"b".repeat(64)));
 assert.equal(f.calls.filter(c=>new URL(c.url).pathname==="/delete").length,0);
 await f.provider.removeVerifiedCopy(key,r.account_sha256,hash);
 const deleted=f.calls.filter(c=>new URL(c.url).pathname==="/delete");assert.equal(deleted.length,1);
 assert.deepEqual(deleted[0]!.body,{paths:[`/fixture/${puterFilename(key)}`],recursive:false,descendants_only:false});
});
