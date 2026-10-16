import test from "node:test";
import assert from "node:assert/strict";
import {nativeFixtureInput} from "../testing/native-fixture.ts";
import {puterProfileSchema,aurayProfileSchema} from "./native-contract.ts";
import {NATIVE_PUTER,puterBudget,puterContractIdentity} from "./puter-contract.ts";
import {buildNativeScript} from "./native-chapter.ts";
import {scriptJsonSchema} from "../schemas/script-json.ts";
import {canonicalStringify,sha256Hex} from "../validators/hash-utils.ts";

test("Puter budgets expose an empirical estimate in its own credits, never a money conversion or pooled capacity",async()=>{
 assert.equal(await sha256Hex(canonicalStringify(puterContractIdentity)),NATIVE_PUTER.contractSha256);
 assert.equal(puterBudget(3,1000).required_credits,990);assert.equal(puterBudget(3,1000).estimated_chapters,1);
 assert.equal(puterBudget(3,677.7).estimated_chapters,0);assert.equal(puterBudget(3,1000,330).estimated_chapters,0);
 assert.equal(puterBudget(6,1000).estimated_chapters,0);assert.equal(puterBudget(3,null).estimated_chapters,null);
 assert.equal(puterBudget(3,2000).estimated_chapters,null,"unknown purchased balance is not a free pool");
 assert.equal(puterBudget(3,1000).provider_quote,false);assert.equal(puterBudget(3,1000).budget_basis,"empirical_conservative_estimate");
 assert.throws(()=>puterBudget(4,1000));assert.throws(()=>puterBudget(3,1000,-1));
});

test("Puter profile and delivered 30 FPS clips cannot enter Auray's frozen 24 FPS contract",async()=>{
 const a=nativeFixtureInput(),profile=puterProfileSchema.parse({...a.profile,version:NATIVE_PUTER.version,model:NATIVE_PUTER.model,
   contract_sha256:NATIVE_PUTER.contractSha256,width:720,height:1280,output_fps:30});
 assert.equal(aurayProfileSchema.safeParse(profile).success,false);
 assert.equal(puterProfileSchema.safeParse({...profile,output_fps:24}).success,false);
 const clips=[0,1,2].map(i=>({request_key:String(i+1).repeat(64),sha256:String(i+4).repeat(64),frames:150,path:`episodes/${a.episodeId}/native/${String(i+4).repeat(64)}.mp4`}));
 const script=await buildNativeScript({...a,episode:a.episodeId,profile,clips,origin:"https://fixture.supabase.co"});
 assert.equal(script.narration.estimated_duration_seconds,15);assert.equal(script.fiction!.native_animation!.provider,"puter");
 assert.equal(script.fiction!.native_animation!.output_fps,30);assert.equal(script.fiction!.native_animation!.voice_identity_preserved,false);
 const changed=structuredClone(script);changed.scenes[0]!.native_animation!.frames=120;
 assert.equal(scriptJsonSchema.safeParse(changed).success,false);
 await assert.rejects(buildNativeScript({...a,episode:a.episodeId,profile:a.profile,clips,origin:"https://fixture.supabase.co"}));
 await assert.rejects(buildNativeScript({...a,episode:a.episodeId,profile,clips:clips.map(c=>({...c,frames:120})),origin:"https://fixture.supabase.co"}));
});
