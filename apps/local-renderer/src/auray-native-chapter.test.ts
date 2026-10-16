import test from "node:test";
import assert from "node:assert/strict";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {createNativeRun,advanceNativeChapter,validateNativeRun,type NativeRun,type NativeChapterDependencies} from "./auray-native-chapter.ts";
import {AurayError,missingAurayKey,type AurayInspection,type AurayJob} from "./auray-video-provider.ts";

const now=Date.parse("2026-10-15T12:00:00Z"),account="99999999-9999-4999-8999-999999999999";
function report(remaining=30):AurayInspection {
  return {...missingAurayKey(new Date(now)),account_id:account,key_id:"fixture-key",period:"2026-10",monthly_allowance:50,
    plan_remaining:remaining,key_remaining:remaining,audition_remaining:Math.min(5,remaining),contract_sha256:"d".repeat(64),
    financially_eligible:remaining>=5,blockers:remaining>=5?[]:["insufficient_free_credits"]};
}
async function fixture(remaining=30,shots:3|6|9=3) {
  const a=nativeFixtureInput(shots);let current=await createNativeRun({episode_id:a.episodeId,...a},report(remaining),now);
  const calls:string[]=[],remote=new Map<string,AurayJob>();let budget=remaining,lease=true;
  const deps:NativeChapterDependencies={now:()=>now,guard:async()=>{calls.push("guard");if(!lease)throw Error("lease_lost");},
    provider:{inspect:async()=>report(budget),upload:async(_image,key,id)=>{calls.push("upload");return `${id}/api-${key}.png`;},
      submit:async(_shot,_path,key,_report,options)=>{
        calls.push(`submit:${key}`);const task=current.tasks.find(t=>t.request_key===key)!;assert.equal(task.phase,task.rate_limit_retries?"submission_unknown":"submission_started");
        assert.deepEqual(options,{allowNativeDialogueProbe:true,allowNativeChapter:true});budget-=5;
        const id=`video_${key}`;remote.set(id,{id,job_id:id,object:"job",product:"video",model:"auray-ai/minimax-h3/text-to-video",status:"succeeded",settled:true,credits_charged:5,poll_after_seconds:30,created_at:new Date(now).toISOString()});return id;
      },status:async(id)=>{calls.push(`status:${id}`);const value=remote.get(id);if(!value)throw new AurayError("not_found");return value;}},
    reference:async()=>{calls.push("reference");return new Uint8Array([1]);},
    verifyReuse:async()=>{calls.push("verify_reuse");},
    save:async(next)=>{calls.push(`save:${next.revision}`);assert.equal(next.revision,current.revision+1);current=structuredClone(next);},
    collect:async(job)=>{calls.push(`collect:${job}`);const i=current.tasks.findIndex(t=>t.job_id===job);assert.equal(current.tasks[i]!.charged_credits,5);
      const sha=String(i+1).repeat(64);return {request_key:job.slice(6),sha256:sha,frames:120,path:`episodes/${current.episode_id}/native/${sha}.mp4`};},
    assemble:async(run)=>{calls.push("assemble");assert.ok(run.tasks.every(t=>t.phase==="ready"));const base=`episodes/${run.episode_id}/native/`;
      return {path:`${base}${"a".repeat(64)}.mp4`,sha256:"a".repeat(64),bytes:100,script_path:`${base}${"b".repeat(64)}.json`,script_sha256:"b".repeat(64),qa_path:`${base}${"c".repeat(64)}.json`,qa_sha256:"c".repeat(64)};},
  };
  return {deps,calls,remote,get state(){return current;},set state(v:NativeRun){current=v;},set budget(v:number){budget=v;},set lease(v:boolean){lease=v;}};
}

test("a scene repair reserves five credits, reuses untouched clips, and never submits them",async()=>{
 for(const index of [0,1,2]) {
  const f=await fixture(5+15),source=nativeFixtureInput(),origin="55555555-5555-4555-8555-555555555555";
  const reuse=[0,1,2].filter(i=>i!==index).map(i=>({index:i,episode_id:origin,clip:{request_key:String(i+1).repeat(64),sha256:String(i+4).repeat(64),frames:120,path:`episodes/${origin}/native/${String(i+4).repeat(64)}.mp4`}}));
  f.state=await createNativeRun({episode_id:source.episodeId,...source,reuse},report(5),now);f.budget=5;
  assert.equal(f.state.reserved_credits,5);assert.equal(f.state.tasks[index]!.phase,"planned");assert.equal(f.state.tasks.filter(t=>t.reused).length,2);
  await validateNativeRun(f.state);
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"submitted");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).budget_reconciled,true);
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,1);assert.equal(f.calls.filter(c=>c.startsWith("status:")).length,1);
  assert.ok(f.calls.indexOf("verify_reuse")<f.calls.indexOf("upload"));
  if(index===1) {
    const blocked=await fixture(20);blocked.state=await createNativeRun({episode_id:source.episodeId,...source,reuse},report(5),now);blocked.budget=5;
    blocked.deps.verifyReuse=async()=>{throw Error("cached_output_changed");};
    await assert.rejects(advanceNativeChapter(blocked.state,blocked.deps),/cached_output_changed/);
    delete blocked.deps.verifyReuse;await assert.rejects(advanceNativeChapter(blocked.state,blocked.deps),/native_reuse_unverified/);
    assert.equal(blocked.calls.some(c=>c.startsWith("submit:")||c==="upload"),false);
  }
  const tampered=structuredClone(f.state),reused= tampered.tasks.find(t=>t.reused)!;
  reused.clip!.sha256="f".repeat(64);await assert.rejects(validateNativeRun(tampered));
 }
});
test("full chapter requires all fifteen recurring Free credits before any new request",async()=>{
  const a=nativeFixtureInput();
  for(const remaining of [0,5,10,14])await assert.rejects(createNativeRun({episode_id:a.episodeId,...a},report(remaining),now),/complete_chapter_budget_required/);
  const r=report();r.contract_sha256="f".repeat(64);
  await assert.rejects(createNativeRun({episode_id:a.episodeId,...a},r,now));
  const f=await fixture();f.budget=14;
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");assert.ok(!f.calls.includes("upload"));
});
test("three takes run sequentially, original charges persist before downloads, final output requires review",async()=>{
  const f=await fixture(15);
  for(let i=0;i<3;i++) {
    assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"submitted");
    assert.equal(f.state.tasks[i]!.phase,"submitted");
    assert.equal(f.state.tasks.filter(t=>t.phase==="planned").length,2-i);
    assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
  }
  const result=await advanceNativeChapter(f.state,f.deps);
  assert.deepEqual(result,{code:"review_pending",poll_after_seconds:0,budget_reconciled:true});
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,3);
  assert.ok(f.state.output);assert.equal(f.state.budget_reconciled,true);
  await advanceNativeChapter(f.state,f.deps);
  assert.equal(f.calls.filter(c=>c==="assemble").length,1);assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,3);
});
test("a POST timeout after acceptance recovers the original job without resubmission",async()=>{
  const f=await fixture(),submit=f.deps.provider.submit;
  f.deps.provider.submit=async(...args)=>{await submit(...args);throw new AurayError("transport_failed","unknown");};
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  assert.equal(f.state.tasks[0]!.phase,"submission_unknown");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,1);
});
test("crash after recording submission identity but before POST stays read-only even on 404",async()=>{
  const f=await fixture(),save=f.deps.save;
  f.deps.save=async(next)=>{await save(next);if(next.tasks[0]!.phase==="submission_started")throw Error("lost_database_response");};
  await assert.rejects(advanceNativeChapter(f.state,f.deps),/lost_database_response/);
  f.deps.save=save;
  for(let i=0;i<2;i++)assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"waiting");
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,0);
});
test("lost persistence acknowledgement after POST also cannot create a second job",async()=>{
  const f=await fixture(),save=f.deps.save;
  f.deps.save=async(next)=>{if(next.tasks[0]!.phase==="submitted")throw Error("write_not_saved");await save(next);};
  await assert.rejects(advanceNativeChapter(f.state,f.deps),/write_not_saved/);
  assert.equal(f.state.tasks[0]!.phase,"submission_started");f.deps.save=save;
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,1);
});
test("credit exhaustion or a new period blocks unsubmitted shots while recovering an accepted one",async()=>{
  const f=await fixture();await advanceNativeChapter(f.state,f.deps);f.budget=0;
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  f.deps.now=()=>Date.parse("2026-11-01T12:00:00Z");
  f.deps.provider.inspect=async()=>({...report(),checked_at:"2026-11-01T12:00:00Z",period:"2026-11"});
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,1);
});
test("foreign account, stale report and missing account lease prevent submissions",async()=>{
  for(const change of [(r:AurayInspection)=>{r.account_id="11111111-1111-4111-8111-111111111111";},
    (r:AurayInspection)=>{r.checked_at="2026-10-15T11:00:00Z";},(r:AurayInspection)=>{r.key_id="different-key";}]) {
    const f=await fixture(),r=report();change(r);f.deps.provider.inspect=async()=>r;
    assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");assert.ok(!f.calls.includes("upload"));
  }
  const f=await fixture();f.lease=false;await assert.rejects(advanceNativeChapter(f.state,f.deps),/lease_lost/);assert.ok(!f.calls.includes("upload"));
});
test("failed generation does not rotate providers, replace a take or release reserved budget",async()=>{
  const f=await fixture();await advanceNativeChapter(f.state,f.deps);
  const job=f.remote.get(f.state.tasks[0]!.job_id)!;job.status="failed";
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  assert.equal(f.state.budget_reconciled,false);assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,1);
});
test("billing lag holds the account even after all media is assembled",async()=>{
  const f=await fixture();for(let i=0;i<6;i++)await advanceNativeChapter(f.state,f.deps);
  f.budget=30;assert.equal((await advanceNativeChapter(f.state,f.deps)).budget_reconciled,false);
  assert.ok(f.state.output);assert.equal(f.state.budget_reconciled,false);
  f.budget=15;assert.equal((await advanceNativeChapter(f.state,f.deps)).budget_reconciled,true);
});
test("checkpoint tampering cannot change the cast, job identity, accepted phase or media scope",async()=>{
  const f=await fixture();
  for(const change of [(r:NativeRun)=>{r.draft.scenes[0]!.narration_text="Outra fala diferente agora.";},
    (r:NativeRun)=>{r.tasks[0]!.job_id=`video_${"e".repeat(64)}`;},
    (r:NativeRun)=>{r.tasks[1]!.phase="submitted";},
    (r:NativeRun)=>{r.budget_reconciled=true;}]) {
    const r=structuredClone(f.state);change(r);await assert.rejects(validateNativeRun(r));
  }
});
test("provider polling delay survives a restart and is never shortened to five minutes",async()=>{
 const f=await fixture();await advanceNativeChapter(f.state,f.deps);
 const job=f.remote.get(f.state.tasks[0]!.job_id)!;job.status="running";job.settled=false;job.poll_after_seconds=1200;
 assert.equal((await advanceNativeChapter(f.state,f.deps)).poll_after_seconds,1200);
 const before=f.calls.filter(c=>c.startsWith("status:")).length;
 assert.equal((await advanceNativeChapter(structuredClone(f.state),f.deps)).poll_after_seconds,1200);
 assert.equal(f.calls.filter(c=>c.startsWith("status:")).length,before);
 f.deps.now=()=>now+1200_000;job.status="succeeded";job.settled=true;
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
});
test("HTTP Retry-After is persisted; unavailable billing cannot hide a completed private film",async()=>{
 const f=await fixture();await advanceNativeChapter(f.state,f.deps);
 f.deps.provider.status=async()=>{throw new AurayError("rate_limited","none",900);};
 assert.equal((await advanceNativeChapter(f.state,f.deps)).poll_after_seconds,900);assert.ok(f.state.not_before);
 const done=await fixture();for(let i=0;i<6;i++)await advanceNativeChapter(done.state,done.deps);
 done.deps.provider.inspect=async()=>{throw new AurayError("service_unavailable");};
 assert.equal((await advanceNativeChapter(done.state,done.deps)).code,"review_pending");
 assert.ok(done.state.output);assert.equal(done.state.budget_reconciled,false);
});

test("a definite uncharged 429 waits across restart then retries the identical job once",async()=>{
 const f=await fixture(),submit=f.deps.provider.submit;let attempts=0;
 f.deps.provider.submit=async(...args)=>{if(++attempts===1)throw new AurayError("rate_limited","none",900);return submit(...args);};
 assert.deepEqual(await advanceNativeChapter(f.state,f.deps),{code:"waiting",poll_after_seconds:900,error_code:"rate_limited"});
 const identity=f.state.tasks[0]!.request_key;
 assert.equal((await advanceNativeChapter(structuredClone(f.state),f.deps)).poll_after_seconds,900);assert.equal(attempts,1);
 f.deps.now=()=>now+900_000;f.deps.provider.inspect=async()=>({...report(),checked_at:new Date(now+900_000).toISOString()});
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"submitted");
 assert.equal(f.state.tasks[0]!.rate_limit_retries,1);assert.equal(f.state.tasks[0]!.request_key,identity);
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");assert.equal(attempts,2);assert.equal(f.state.tasks[0]!.charged_credits,5);
});

test("a second definite 429 and other definite refusals cannot create a retry loop",async()=>{
 const f=await fixture();let attempts=0,clock=now;
 f.deps.now=()=>clock;f.deps.provider.inspect=async()=>({...report(),checked_at:new Date(clock).toISOString()});
 f.deps.provider.submit=async()=>{attempts++;throw new AurayError("rate_limited","none");};
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"waiting");clock+=60_000;
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");clock+=60_000;
 for(let i=0;i<3;i++)assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
 assert.equal(attempts,2);assert.equal(f.state.tasks[0]!.charged_credits,0);assert.equal(f.state.budget_reconciled,false);
 const denied=await fixture();denied.deps.provider.submit=async()=>{throw new AurayError("access_denied","none");};
 assert.equal((await advanceNativeChapter(denied.state,denied.deps)).code,"blocked");
 const before=denied.calls.length;await advanceNativeChapter(denied.state,denied.deps);
 assert.ok(!denied.calls.slice(before).includes("upload"));
});

test("lost retry acknowledgement recovers the same accepted job; lost retry intent never POSTs",async()=>{
 for(const crashBeforePost of [false,true]) {
  const f=await fixture(),submit=f.deps.provider.submit,save=f.deps.save;let attempts=0;
  f.deps.provider.submit=async(...args)=>{if(++attempts===1)throw new AurayError("rate_limited","none");await submit(...args);throw new AurayError("transport_failed","unknown");};
  await advanceNativeChapter(f.state,f.deps);
  f.deps.now=()=>now+60_000;f.deps.provider.inspect=async()=>({...report(),checked_at:new Date(now+60_000).toISOString()});
  if(crashBeforePost)f.deps.save=async(next)=>{await save(next);if(next.tasks[0]!.rate_limit_retries)throw Error("lost_retry_intent_ack");};
  if(crashBeforePost)await assert.rejects(advanceNativeChapter(f.state,f.deps),/lost_retry_intent_ack/);
  else assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");
  f.deps.save=save;
  assert.equal(f.state.tasks[0]!.phase,"submission_unknown");
  assert.equal((await advanceNativeChapter(f.state,f.deps)).code,crashBeforePost?"waiting":"collected");
  assert.equal(attempts,crashBeforePost?1:2);
 }
});

test("a definite rate-limit recovery still requires the entire remaining budget and lease",async()=>{
 const f=await fixture(),submit=f.deps.provider.submit;f.deps.provider.submit=async()=>{throw new AurayError("rate_limited","none");};
 await advanceNativeChapter(f.state,f.deps);f.deps.now=()=>now+60_000;
 f.deps.provider.inspect=async()=>({...report(14),checked_at:new Date(now+60_000).toISOString()});f.deps.provider.submit=submit;
 assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"blocked");assert.equal(f.state.tasks[0]!.rate_limit_retries,undefined);
 f.deps.provider.inspect=async()=>({...report(),checked_at:new Date(now+60_000).toISOString()});f.lease=false;
 await assert.rejects(advanceNativeChapter(f.state,f.deps),/lease_lost/);assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,0);
});


test("30s and 45s require a complete reservation, execute every shot once and repair only the selected shot",async()=>{
 for(const shots of [6,9] as const) {
  const a=nativeFixtureInput(shots);
  await assert.rejects(createNativeRun({episode_id:a.episodeId,...a},report(shots*5-1),now),/complete_chapter_budget_required/);
  const f=await fixture(shots*5,shots);assert.equal(f.state.reserved_credits,shots*5);
  for(let i=0;i<shots;i++) {
   assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"submitted");
   assert.equal((await advanceNativeChapter(f.state,f.deps)).code,"collected");
   // Recover from persisted JSON between each shot; no accepted submission repeats.
   f.state=await validateNativeRun(JSON.parse(JSON.stringify(f.state)));
  }
  assert.equal((await advanceNativeChapter(f.state,f.deps)).budget_reconciled,true);
  assert.equal(f.calls.filter(c=>c.startsWith("submit:")).length,shots);
  for(const index of [0,shots-1]) {
   const origin=f.state.episode_id,target="55555555-5555-4555-8555-555555555555";
   const reuse=f.state.tasks.flatMap((t,i)=>i===index?[]:[{index:i,episode_id:origin,clip:t.clip!}]);
   const repaired=await fixture(shots*5,shots);
   repaired.state=await createNativeRun({episode_id:target,...a,reuse},report(5),now);repaired.budget=5;
   assert.equal(repaired.state.reserved_credits,5);assert.equal(repaired.state.tasks.filter(t=>t.reused).length,shots-1);
   await advanceNativeChapter(repaired.state,repaired.deps);await advanceNativeChapter(repaired.state,repaired.deps);
   assert.equal((await advanceNativeChapter(repaired.state,repaired.deps)).budget_reconciled,true);
   assert.equal(repaired.calls.filter(c=>c.startsWith("submit:")).length,1);
   assert.equal(repaired.calls.filter(c=>c.startsWith("status:")).length,1);
   assert.ok(repaired.calls.indexOf("verify_reuse")<repaired.calls.indexOf("upload"));
  }
  const short=structuredClone(f.state);short.tasks.pop();await assert.rejects(validateNativeRun(short));
  await assert.rejects(createNativeRun({episode_id:a.episodeId,...a,reuse:[{index:shots,episode_id:"55555555-5555-4555-8555-555555555555",clip:f.state.tasks[0]!.clip!}]},report(50),now));
 }
});
