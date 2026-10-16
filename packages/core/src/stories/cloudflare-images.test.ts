import test from "node:test";
import assert from "node:assert/strict";
import {generateCloudflareReference,inspectCloudflareImages,CLOUDFLARE_IMAGE_MODEL} from "./cloudflare-images.ts";
const credential={account_id:"a".repeat(32),token:"fixture_".repeat(6)};
function transport(subscriptions:unknown[]=[],status=200){const calls:Array<{url:string;method:string}>=[];const fetcher:typeof fetch=async(input,init)=>{const url=String(input);calls.push({url,method:init?.method??"GET"});assert.equal(init?.redirect,"error");
 if(url.endsWith("/subscriptions"))return Response.json({success:true,result:subscriptions},{status});
 if(url.includes("/ai/models/search"))return Response.json({success:true,result:[{name:CLOUDFLARE_IMAGE_MODEL}]});
 if(url.includes("/ai/run/"))return Response.json({success:true,result:{image:btoa("image-fixture")}});throw Error("unexpected_request");};return {calls,fetcher};}
test("image generation verifies a Free account and model before the single POST",async()=>{
 const t=transport();assert.equal((await inspectCloudflareImages(credential,t.fetcher)).remaining_neurons,null);
 const bytes=await generateCloudflareReference(credential,"Original adult apple character in a cinematic 3D illustration.",t.fetcher);
 assert.equal(new TextDecoder().decode(bytes),"image-fixture");assert.equal(t.calls.filter(c=>c.method==="POST").length,1);
});
test("paid, promotional and unverifiable accounts cannot generate or fall back",async()=>{
 for(const [subscriptions,status] of [[[{state:"active",rate_plan:{id:"workers_paid",price:5}}],200],[[{state:"active",rate_plan:{id:"workers_standard_trial",price:0}}],200],[[{state:"active",rate_plan:{id:"unknown",price:0}}],200],[[],403]] as const){
  const t=transport([...subscriptions],status);await assert.rejects(generateCloudflareReference(credential,"A detailed original adult character in a clean reference portrait.",t.fetcher));assert.equal(t.calls.some(c=>c.method==="POST"),false);
 }
});
