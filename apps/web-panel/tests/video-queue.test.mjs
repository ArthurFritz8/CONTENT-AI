import {test} from "node:test";
import assert from "node:assert/strict";
import {queueCommandSchema,queueEnqueueTarget,videoQueuePreview} from "../lib/video-queue.ts";
const episode="11111111-1111-4111-8111-111111111111",series="22222222-2222-4222-8222-222222222222",queue="33333333-3333-4333-8333-333333333333";
const now=1800000000000;
function fixture(state="pending") {
 const shot={version:"1.0.0",id:"take",kind:"dialogue",reference_path:"private/reference.png",reference_sha256:"a".repeat(64),audio_path:"private/audio.wav",audio_sha256:"b".repeat(64),
  prompt:"Medium close-up with gentle gestures and clear facial identity.",seconds:3.9375,seed:2007,quality:"approved_master",min_short_edge:704,min_output_fps:60,continuity:{series_id:series,profile_sha256:"c".repeat(64)}};
 return {entries:[{id:episode,series_id:series,title:"Queue fixture",chapter_number:1,priority:100,created_at:now-1000,queue_id:state==="prepared"?null:queue,revision:0,state,
  profile_sha256:"c".repeat(64),previous_approved:true,blocked_code:null,shots:Array.from({length:5},(_,index)=>({shot:{...shot,id:`take_${index}`},quotes:[{provider_id:"wallet",execution_sha256:"d".repeat(64),units:10,cash_cost:0}]}))}],
 providers:[{id:"wallet",label:"Approved source",quota_group:"physical-wallet",capabilities:["dialogue"],quality:["approved_master"],short_edge:704,output_fps:60,max_seconds:3.9375,
  available:true,adapter_ready:true,checked_at:now,cooldown_until:0,free_remaining:100,billing:"credits",free_tier:"recurring",reserved:0,required:1,cash_cost:0,execution_sha256:"d".repeat(64),
  continuity_approvals:[{series_id:series,profile_sha256:"c".repeat(64),execution_sha256:"d".repeat(64),capabilities:["dialogue"]}]}],
 wallets:[{quota_group:"physical-wallet",unit:"credits",remaining_units:100,held_units:0,checked_at:now,valid_until:now+60000}],queue:{cursor_revision:0,after_quota_group:null,reservation_enabled:false}};
}
test("queue preview uses the core planner without exposing private inputs or enabling dispatch",()=>{
 const raw=fixture(),before=JSON.stringify(raw),result=videoQueuePreview(raw,now);
 assert.equal(result.items[0].status,"planned");assert.equal(result.estimated_complete_chapters,1);assert.equal(result.items[0].source_label,"Approved source");
 assert.equal(result.dispatch_enabled,false);assert.equal(result.reservation_enabled,false);assert.equal(JSON.stringify(raw),before);
 assert.doesNotMatch(JSON.stringify(result),/private\/|audio_sha256|reference_sha256|allocations|profile_sha256|execution_sha256/);
});
test("prepared chapters can be queued but are not counted as persisted production",()=>{
 const raw=fixture("prepared"),result=videoQueuePreview(raw,now);
 assert.equal(result.items[0].can_enqueue,true);assert.equal(result.estimated_complete_chapters,0);
 assert.deepEqual(queueEnqueueTarget(raw,episode),{episode_id:episode,profile_sha256:"c".repeat(64)});
 assert.equal(queueEnqueueTarget(raw,series),null);
});
test("database clock is used consistently for entries and source freshness",()=>{
 const raw=fixture();raw.checked_at=now;
 assert.equal(videoQueuePreview(raw).checked_at,now);assert.equal(videoQueuePreview(raw).estimated_complete_chapters,1);
});
test("stale or insufficient balances and obsolete scripts fail closed",()=>{
 for(const mutation of [raw=>raw.wallets[0].remaining_units=40,raw=>raw.wallets[0].checked_at=now-300001]) {
  const raw=fixture();mutation(raw);assert.equal(videoQueuePreview(raw,now).items[0].status,"waiting_capacity");
 }
 const raw=fixture();raw.entries[0].blocked_code="script_changed";assert.equal(videoQueuePreview(raw,now).items[0].status,"script_changed");
 raw.entries[0].shots[0].shot.prompt="invalid";assert.equal(videoQueuePreview(raw,now).items[0].status,"awaiting_preparation");
});
test("previous human review and incomplete planning windows cannot yield a dispatchable estimate",()=>{
 const raw=fixture();raw.entries[0].chapter_number=2;raw.entries[0].previous_approved=false;
 assert.equal(videoQueuePreview(raw,now).items[0].status,"waiting_review");
 raw.entries=Array.from({length:101},()=>({...raw.entries[0]}));const result=videoQueuePreview(raw,now);
 assert.equal(result.truncated,true);assert.equal(result.estimated_complete_chapters,0);
});
test("queue commands reject browser-supplied actor, profile, plans and reserve actions",()=>{
 assert.equal(queueCommandSchema.safeParse({action:"enqueue",episodeId:episode,requestId:queue}).success,true);
 for(const value of [{action:"reserve"},{action:"enqueue",episodeId:episode,requestId:queue,p_actor:series},
  {action:"enqueue",episodeId:episode,requestId:queue,profile:"a".repeat(64)},{action:"cancel",queueId:queue,revision:-1}])
  assert.equal(queueCommandSchema.safeParse(value).success,false);
});