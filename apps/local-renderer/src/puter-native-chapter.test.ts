import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {nativeFixtureInput} from "../../../packages/core/src/testing/native-fixture.ts";
import {puterProfileSchema} from "../../../packages/core/src/stories/native-contract.ts";
import {NATIVE_PUTER} from "../../../packages/core/src/stories/puter-contract.ts";
import {createPuterRun,validatePuterRun,advancePuterChapter,type PuterRun,type PuterChapterDependencies} from "./puter-native-chapter.ts";
import {PuterError,puterFilename,type PuterInspection,type PuterShot} from "./puter-video-provider.ts";

const time=Date.parse("2026-10-16T18:00:00Z"),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function fixture() {
 const a=nativeFixtureInput(),refs=new Map<string,Buffer>();
 const profile=puterProfileSchema.parse({...a.profile,version:NATIVE_PUTER.version,model:NATIVE_PUTER.model,contract_sha256:NATIVE_PUTER.contractSha256,width:720,height:1280,output_fps:30});
 for(const ref of profile.references){const bytes=Buffer.from(`image-${ref.character_id}`);ref.sha256=hash(bytes);refs.set(ref.path,bytes);}
 const report:PuterInspection={provider:"puter",account_sha256:"c".repeat(64),checked_at:new Date(time).toISOString(),remaining_credits:1000,
   monthly_allowance:1000,storage_free_bytes:20*1024*1024,unit:"credits",financially_eligible:true,contract_sha256:NATIVE_PUTER.contractSha256,
   budget_basis:NATIVE_PUTER.budgetBasis,provider_quote:false,blockers:[]};
 let saved=await createPuterRun({episode_id:a.episodeId,context:a.context,draft:a.draft,profile},report,time);
 const remote=new Map<string,Buffer>(),cache=new Map<string,Buffer>(),sent:string[]=[],events:string[]=[];
 const flags={loseResponse:false,failMedia:false,loseSave:false,denyGuard:false};
 const deps:PuterChapterDependencies={now:()=>time,guard:async(submission)=>{events.push(submission?"guard_submit":"guard");if(flags.denyGuard)throw new Error("lease_lost");},
   save:async next=>{assert.equal(next.revision,saved.revision+1);events.push(`save:${next.tasks.map(t=>t.phase).join(",")}`);saved=structuredClone(next);
     if(flags.loseSave){flags.loseSave=false;throw new Error("save_ack_lost");}},
   reference:async(path,digest)=>{const b=refs.get(path)!;assert.equal(hash(b),digest);return b;},
   cached:async(path,digest)=>{const b=cache.get(path);if(b)assert.equal(hash(b),digest);return b??null;},
   duringSubmit:async operation=>operation(),
   provider:{inspect:async()=>structuredClone(report),submit:async(raw,_image,key)=>{
     assert.equal(saved.tasks.find(t=>t.request_key===key)?.phase,"submission_started");
     assert.equal(sent.includes(key),false,"no duplicate provider POST");sent.push(key);events.push("post");
     const shot=raw as PuterShot;assert.equal(shot.chapter_binding.episode_id,a.episodeId);
     remote.set(key,Buffer.from(`original-file-${key}`));report.remaining_credits!-=320;
     if(flags.loseResponse){flags.loseResponse=false;throw new PuterError("provider_response_unresolved","unknown");}
     return puterFilename(key);
   },download:async key=>{const bytes=remote.get(key);if(!bytes)throw new PuterError("remote_file_not_ready");return bytes;},
   removeVerifiedCopy:async(key,_account,digest)=>{assert.ok([...cache.values()].some(v=>hash(v)===digest),"private durable copy exists before remote cleanup");remote.delete(key);}},
   collect:async(bytes,key)=>{const digest=hash(bytes),path=`episodes/${a.episodeId}/native/${digest}.mp4`;cache.set(path,Buffer.from(bytes));
     if(flags.failMedia)throw new PuterError("native_media_contract_changed");return {request_key:key,sha256:digest,path,frames:150};},
   assemble:async run=>{assert.ok(run.tasks.every(t=>t.phase==="ready"));const base=`episodes/${a.episodeId}/native/`;
     return {path:base+"a".repeat(64)+".mp4",sha256:"a".repeat(64),bytes:1000,script_path:base+"b".repeat(64)+".json",script_sha256:"b".repeat(64),qa_path:base+"d".repeat(64)+".json",qa_sha256:"d".repeat(64)};},
 };
 return {get saved(){return saved;},report,deps,remote,cache,sent,events,flags,input:{episode_id:a.episodeId,context:a.context,draft:a.draft,profile}};
}
test("whole chapter admission rejects insufficient/stale balances and shares no capacity with another account",async()=>{
 const f=await fixture();
 await assert.rejects(createPuterRun(f.input,{...f.report,remaining_credits:677.7},time),/complete_chapter_budget_required/);
 await assert.rejects(createPuterRun(f.input,{...f.report,checked_at:new Date(time-120001).toISOString()},time));
 const other={...f.saved,account_sha256:"e".repeat(64)};await assert.rejects(validatePuterRun(other),/native_checkpoint_mismatch/);
});
test("three original clips finish with durable intent, cleanup and review, no replacement of voices or frames",async()=>{
 const f=await fixture();
 for(let step=0;step<12&&!f.saved.budget_reconciled;step++)await advancePuterChapter(f.saved,f.deps);
 assert.equal(f.sent.length,3);assert.equal(f.saved.tasks.every(t=>t.phase==="ready"&&t.cleanup_done),true);
 assert.equal(f.saved.budget_reconciled,true);assert.ok(f.saved.output);assert.equal(f.remote.size,0);assert.equal(f.cache.size,3);
 assert.equal(f.saved.profile.output_fps,30);assert.equal(f.saved.profile.voice_policy,"provider_generated_review");
 assert.ok(f.events.findIndex(e=>e.startsWith("save:submission_started"))<f.events.indexOf("post"));
});
test("lost POST response recovers exactly that private file and never submits the same scene again",async()=>{
 const f=await fixture();f.flags.loseResponse=true;
 const first=await advancePuterChapter(f.saved,f.deps);assert.equal(first.code,"waiting");assert.equal(f.saved.tasks[0]!.phase,"submission_unknown");
 assert.equal((await advancePuterChapter(f.saved,f.deps)).code,"collected");assert.equal(f.sent.length,1);
 for(let step=0;step<10&&!f.saved.budget_reconciled;step++)await advancePuterChapter(f.saved,f.deps);
 assert.equal(f.sent.length,3);assert.equal(f.saved.budget_reconciled,true);
});
test("lost persistence acknowledgement before POST stays read-only even if no remote file is found",async()=>{
 const f=await fixture();f.flags.loseSave=true;
 await assert.rejects(advancePuterChapter(f.saved,f.deps),/save_ack_lost/);
 assert.equal(f.saved.tasks[0]!.phase,"submission_started");assert.equal(f.sent.length,0);
 assert.equal((await advancePuterChapter(f.saved,f.deps)).code,"waiting");assert.equal(f.sent.length,0);
});
test("external credit spend pauses before another scene and keeps already verified clips",async()=>{
 const f=await fixture();await advancePuterChapter(f.saved,f.deps);await advancePuterChapter(f.saved,f.deps);
 f.report.remaining_credits=300;
 assert.equal((await advancePuterChapter(f.saved,f.deps)).code,"blocked");assert.equal(f.sent.length,1);
 assert.equal(f.saved.tasks[0]!.phase,"ready");assert.equal(f.saved.tasks[1]!.phase,"planned");assert.equal(f.cache.size,1);
});
test("wrong media is terminal and cannot become a completed or silently shortened chapter",async()=>{
 const f=await fixture();f.flags.failMedia=true;await advancePuterChapter(f.saved,f.deps);
 await assert.rejects(advancePuterChapter(f.saved,f.deps),/native_media_contract_changed/);
 assert.equal(f.saved.tasks[0]!.remote_complete,true);assert.equal(f.saved.tasks[0]!.phase,"failed");
 assert.equal((await advancePuterChapter(f.saved,f.deps)).code,"blocked");assert.equal(f.sent.length,1);assert.equal(f.saved.output,null);
});
test("frozen references, context, paths and request keys cannot be swapped across episodes",async()=>{
 const f=await fixture();
 for(const change of [(v:PuterRun)=>{v.tasks[0]!.request_key="a".repeat(64);},
   (v:PuterRun)=>{v.profile.references[0]!.sha256="b".repeat(64);},
   (v:PuterRun)=>{v.draft.scenes[0]!.narration_text="Quero sair daqui agora.";},
   (v:PuterRun)=>{v.episode_id="22222222-2222-4222-8222-222222222222";}]) {
  const v=structuredClone(f.saved);change(v);await assert.rejects(validatePuterRun(v));
 }
});
