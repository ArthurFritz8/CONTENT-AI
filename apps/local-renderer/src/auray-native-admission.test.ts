import test from "node:test";
import assert from "node:assert/strict";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {nativeFingerprint} from "../../../packages/core/src/stories/native-chapter.ts";
import {missingAurayKey} from "./auray-video-provider.ts";
import {admitNativeChapter} from "./auray-native-admission.ts";
test("draft admission reserves the complete verified Free budget and recovers an existing run without a new inspection",async()=>{
 const a=nativeFixtureInput(),fingerprint=await nativeFingerprint(a.draft,a.context,a.profile),calls:string[]=[];
 const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name==="native_worker_input")return {code:"prepare",wallet_id:a.context.series_id,...a,fingerprint};
  assert.equal(name,"reserve_native_chapter");const state=args.p_run as {reserved_credits:number;fingerprint:string};assert.equal(state.reserved_credits,15);assert.equal(state.fingerprint,fingerprint);return {code:"reserved"};};
 const inspect=async()=>({...missingAurayKey(),account_id:a.episodeId,key_id:"fixture",period:new Date().toISOString().slice(0,7),plan_remaining:30,key_remaining:30,contract_sha256:a.profile.contract_sha256,financially_eligible:true,blockers:[]});
 assert.equal((await admitNativeChapter(a.episodeId,{rpc,inspect})).code,"existing");assert.deepEqual(calls,["native_worker_input","reserve_native_chapter"]);
 for(const code of ["existing","cancelled","wallet_reserved","native_setup_required"] as const)assert.equal((await admitNativeChapter(a.episodeId,{rpc:async()=>({code}),inspect:async()=>{throw Error("must_not_inspect");}})).code,code);
});
test("changed frozen draft and insufficient balance cannot reserve a chapter",async()=>{
 const a=nativeFixtureInput();let reserved=false;
 const rpc=async(name:string)=>{if(name==="reserve_native_chapter"){reserved=true;return {code:"reserved"};}return {code:"prepare",wallet_id:a.context.series_id,...a,fingerprint:"f".repeat(64)};};
 const r={...missingAurayKey(),account_id:a.episodeId,key_id:"fixture",period:new Date().toISOString().slice(0,7),plan_remaining:30,key_remaining:30,contract_sha256:a.profile.contract_sha256,financially_eligible:true,blockers:[]};
 await assert.rejects(admitNativeChapter(a.episodeId,{rpc,inspect:async()=>r}),/native_checkpoint_mismatch/);assert.equal(reserved,false);
 await assert.rejects(admitNativeChapter(a.episodeId,{rpc,inspect:async()=>({...r,key_remaining:10})}),/complete_chapter_budget_required/);assert.equal(reserved,false);
});
