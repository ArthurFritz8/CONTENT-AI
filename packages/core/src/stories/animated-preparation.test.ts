import test from "node:test";
import assert from "node:assert/strict";
import { animatedFixtureInput } from "../testing/animated-fixture.ts";
import { animatedChapterPrompt, validateAnimatedDraft, preparationFingerprint } from "./animated-preparation.ts";

export function preparedFixtureInput() {
  const data=animatedFixtureInput();
  data.profile.voices=data.profile.voices.map((v,i)=>({...v,version:"edge-tts-7.2.8-rate0",voice_id:i ? "pt-BR-AntonioNeural":"pt-BR-FranciscaNeural"}));
  return data;
}
test("draft preparation preserves approved continuity and is deterministic",async()=>{
  const a=preparedFixtureInput();
  assert.equal(validateAnimatedDraft(a.draft,a.context,a.profile).scenes.length,5);
  const prompt=animatedChapterPrompt(a.context,a.profile);
  assert.ok(prompt.includes(JSON.stringify(a.context)));assert.ok(prompt.includes("EXATAMENTE 5"));
  assert.equal(await preparationFingerprint(a.draft,a.context,a.profile),await preparationFingerprint(a.draft,a.context,a.profile));
  const changed=structuredClone(a.draft);changed.scenes[0]!.narration_text="Quem pegou aquela chave?";
  assert.notEqual(await preparationFingerprint(changed,a.context,a.profile),await preparationFingerprint(a.draft,a.context,a.profile));
});
test("draft cannot replace a registered voice, include offscreen speech or hide the speaker",()=>{
  const a=preparedFixtureInput();
  for(const change of [
    (v:typeof a)=>{v.profile.voices[0]!.version="other";},
    (v:typeof a)=>{v.profile.voices[0]!.engine="gemini";},
    (v:typeof a)=>{v.draft.scenes[0]!.visual.speaker_id="narrator";},
    (v:typeof a)=>{v.draft.scenes[0]!.visual.on_stage=["rui"];},
    (v:typeof a)=>{v.draft.scenes[0]!.visual.on_stage=["lia","rui"];},
    (v:typeof a)=>{v.draft.scenes[0]!.narration_text="Uma fala muito longa que não deve prosseguir sem ser corrigida.";},
  ]) {const v=structuredClone(a);change(v);assert.throws(()=>validateAnimatedDraft(v.draft,v.context,v.profile));}
});
