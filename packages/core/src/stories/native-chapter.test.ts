import test from "node:test";
import assert from "node:assert/strict";
import {nativeFixtureInput} from "../testing/native-fixture.ts";
import {buildNativeScript,nativeFingerprint,nativeShot,validateNativeDraft,nativeChapterPrompt,prepareNativeDraft} from "./native-chapter.ts";
import {nativeProfileSchema} from "./native-contract.ts";
import {scriptJsonSchema,isRenderReady} from "../schemas/script-json.ts";
import {createScriptQualityChecker} from "../validators/script-quality.ts";
import {makeValidScript} from "../testing/script-fixture.ts";

const clips=(episode:string)=>[0,1,2].map(i=>({request_key:String(i+1).repeat(64),sha256:String(i+4).repeat(64),frames:120,path:`episodes/${episode}/native/${String(i+4).repeat(64)}.mp4`}));
test("new generation policy locks character details and per-character seed without changing frozen legacy drafts",async()=>{
 const a=nativeFixtureInput(),before=JSON.stringify(a.draft),legacy=await nativeFingerprint(a.draft,a.context,a.profile);
 const draft=prepareNativeDraft(a.draft,a.context,a.profile),fp=await nativeFingerprint(draft,a.context,a.profile);
 assert.notEqual(fp,legacy);assert.equal(JSON.stringify(a.draft),before);
 assert.equal(nativeShot(a.draft,a.context,a.profile,a.episodeId,legacy,0).generation_policy,undefined);
 const shot=nativeShot(draft,a.context,a.profile,a.episodeId,fp,0);
 assert.equal(shot.generation_policy,"reference_dialogue_v2");assert.ok(shot.prompt.includes("fabric colors, pattern"));
 for(const [i,s] of draft.scenes.entries())assert.equal(s.seed,draft.scenes.find(v=>v.visual.speaker_id===s.visual.speaker_id)!.seed);
 const long=structuredClone(a);long.profile.style="s".repeat(700);long.context.bible.cast[0]!.appearance_description="a".repeat(500);long.draft.scenes[0]!.prompt="p".repeat(600);
 const prepared=prepareNativeDraft(long.draft,long.context,long.profile),bounded=nativeShot(prepared,long.context,long.profile,a.episodeId,await nativeFingerprint(prepared,long.context,long.profile),0);
 assert.ok(bounded.prompt.length<=2400);
});
test("native chapter binds continuity and three original clips without claiming fixed voices",async()=>{
  const a=nativeFixtureInput(), fingerprint=await nativeFingerprint(a.draft,a.context,a.profile);
  const shot=nativeShot(a.draft,a.context,a.profile,a.episodeId,fingerprint,0);
  assert.equal(shot.chapter_binding.fingerprint,fingerprint);
  assert.equal(shot.native_dialogue.text,a.draft.scenes[0]!.narration_text);
  assert.ok(shot.prompt.includes(a.profile.style));
  assert.ok(nativeChapterPrompt(a.context,a.profile).includes(JSON.stringify(a.context)));
  const script=await buildNativeScript({episode:a.episodeId,...a,clips:clips(a.episodeId),origin:"https://fixture.supabase.co"});
  assert.equal(script.narration.estimated_duration_seconds,15);
  assert.equal(script.fiction!.native_animation!.voice_identity_preserved,false);
  assert.equal(script.fiction!.native_animation!.speech_transcription_verified,false);
  assert.equal(isRenderReady(script),false,"ordinary renderer must not replace native audio or frames");
  const check=createScriptQualityChecker({blocked_patterns:{absolute:["único no mercado"]},require_source_per_claim:true});
  assert.equal(check(script,[],false).passed,true);
  assert.equal(check(makeValidScript(),[],false).passed,false,"ordinary source checks still apply");
  const changed=structuredClone(a.draft);changed.scenes[0]!.narration_text="Quem roubou a nossa chave?";
  assert.notEqual(await nativeFingerprint(changed,a.context,a.profile),fingerprint);
});
test("native consent, full cast, single visible speaker and short dialogue cannot be omitted",()=>{
  const a=nativeFixtureInput();
  assert.throws(()=>nativeProfileSchema.parse({...a.profile,native_voice_acknowledged:false}));
  assert.throws(()=>nativeProfileSchema.parse({...a.profile,voice_policy:"preserve"}));
  for(const change of [
    (v:typeof a)=>{v.draft.scenes[0]!.visual.on_stage=["rui"];},
    (v:typeof a)=>{v.draft.scenes[0]!.visual.on_stage=["lia","rui"];},
    (v:typeof a)=>{v.draft.scenes[0]!.narration_text="Oi!";},
    (v:typeof a)=>{v.draft.scenes[0]!.narration_text="Uma fala muito longa que não pode caber nesta tomada curta.";},
    (v:typeof a)=>{v.draft.scenes[0]!.narration_text="[gritando] Quero a chave!";},
    (v:typeof a)=>{v.profile.references[0]!.character_id="intruso";},
    (v:typeof a)=>{v.draft.scenes.pop();},
  ]){const v=structuredClone(a);change(v);assert.throws(()=>validateNativeDraft(v.draft,v.context,v.profile));}
});
test("native script rejects mixed motors, missing identity, forged durations and another episode's media",async()=>{
  const a=nativeFixtureInput(),input={episode:a.episodeId,...a,clips:clips(a.episodeId),origin:"https://fixture.supabase.co"};
  const script=await buildNativeScript(input);
  for(const change of [
    (v:typeof script)=>{v.fiction!.native_animation!.voice_identity_preserved=true as false;},
    (v:typeof script)=>{v.scenes[0]!.duration_seconds=5.1;},
    (v:typeof script)=>{delete v.scenes[0]!.native_animation;},
    (v:typeof script)=>{delete v.fiction!.native_animation;},
    (v:typeof script)=>{v.scenes[1]!.native_animation!.request_key=v.scenes[0]!.native_animation!.request_key;},
    (v:typeof script)=>{v.scenes[0]!.story_visual!.on_stage=["rui"];},
    (v:typeof script)=>{v.gap_seconds=.5;},
  ]){const v=structuredClone(script);change(v);assert.equal(scriptJsonSchema.safeParse(v).success,false);}
  input.clips[0]!.path="episodes/someone-else/native/test.mp4";
  await assert.rejects(buildNativeScript(input));
});
