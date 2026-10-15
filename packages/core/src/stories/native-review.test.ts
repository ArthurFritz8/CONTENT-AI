import test from "node:test";
import assert from "node:assert/strict";
import {nativeMediaReviewSchema,unavailableNativeMediaReview} from "./native-review.ts";
const episode="11111111-1111-4111-8111-111111111111",sha="a".repeat(64);
const input=[0,1,2].map(i=>({speaker:i===1?"rui":"lia",sha256:String(i+1).repeat(64),expected_text:"Onde está a passagem?"}));
test("unavailable inspection never becomes an artistic, lip or voice approval",()=>{
 const report=unavailableNativeMediaReview(episode,sha,input);
 assert.equal(report.human_review_required,true);assert.equal(report.lip_sync_verified,false);assert.equal(report.identity_verified,false);
 assert.ok(report.takes.every(t=>t.speech_status==="unavailable"&&t.appearance_status==="unavailable"));
 for(const changed of [{...report,lip_sync_verified:true},{...report,identity_verified:true},{...report,private_key:"forbidden"},{...report,takes:[report.takes[1],report.takes[0],report.takes[2]]}])assert.equal(nativeMediaReviewSchema.safeParse(changed).success,false);
});
