import test from "node:test";
import assert from "node:assert/strict";
import {nativeFixtureInput} from "../testing/native-fixture.ts";
import {repairNativeDraft} from "./native-repair.ts";
test("repair preserves every untouched scene and identity direction",()=>{
 const f=nativeFixtureInput(),edit={index:1,dialogue:f.draft.scenes[1]!.narration_text,prompt:"Medium close-up, one restrained shoulder gesture, crisp eyes and a natural expression.",summary:f.draft.summary};
 const d=repairNativeDraft(f.draft,f.context,f.profile,edit);
 assert.deepEqual(d.scenes[0],f.draft.scenes[0]);assert.deepEqual(d.scenes[2],f.draft.scenes[2]);assert.deepEqual(d.scenes[1]!.visual,f.draft.scenes[1]!.visual);
 assert.equal(d.scenes[1]!.seed,f.draft.scenes[1]!.seed+1);
 assert.throws(()=>repairNativeDraft(f.draft,f.context,f.profile,{...edit,dialogue:"Agora esconda esta carta!"}),/Atualize o resumo/);
 assert.throws(()=>repairNativeDraft(f.draft,f.context,f.profile,{...edit,dialogue:"Sim"}));
});
