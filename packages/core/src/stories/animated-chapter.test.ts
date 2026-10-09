import test from "node:test";
import assert from "node:assert/strict";
import { animatedFixture, animatedFixtureInput } from "../testing/animated-fixture.ts";
import { planAnimatedChapter, shotsFromAnimatedScript } from "./animated-chapter.ts";
import { scriptJsonSchema, isRenderReady } from "../schemas/script-json.ts";
import { computeScriptHash } from "../validators/hash-utils.ts";
import { buildStoryScript } from "./script.ts";
import { storyFixture } from "../testing/story-fixture.ts";
import { createScriptQualityChecker } from "../validators/script-quality.ts";

test("measured chapter has five bound takes, 19.75 seconds and 60 output FPS", async () => {
  const p = await animatedFixture();
  assert.equal(p.animated_seconds, 19.75);
  assert.deepEqual(shotsFromAnimatedScript(p.script), p.shots);
  assert.equal(p.script.fiction!.animation!.output_fps, 60);
  assert.equal(isRenderReady(p.script), false);
  const check = createScriptQualityChecker({ blocked_patterns: { harmful: ["promessa impossível"] }, require_source_per_claim: true });
  assert.equal(check(p.script, [], false).passed, true);
});
test("uncounted long audio, missing audio and a different voice fail before a quote", async () => {
  for (const change of ["long", "missing", "voice", "reference", "speaker", "format"] as const) {
    const input = animatedFixtureInput();
    if (change === "long") input.takes[0]!.audio_seconds = 4;
    if (change === "missing") input.takes.pop();
    if (change === "voice") input.takes[0]!.voice = { ...input.takes[0]!.voice, voice_id: "different" };
    if (change === "reference") input.takes[0]!.reference_path = input.profile.references[1]!.path;
    if (change === "speaker") input.draft.scenes[0]!.visual.speaker_id = "narrator";
    if (change === "format") input.profile.output_fps = 30;
    await assert.rejects(planAnimatedChapter(input));
  }
});
test("short format cannot relax factual or illustrated editorial duration", async () => {
  const f = storyFixture(), old = buildStoryScript(f.draft, f.context, "77777777-7777-4777-8777-777777777777");
  assert.equal(scriptJsonSchema.safeParse({ ...old, scenes: old.scenes.map(s => ({ ...s, duration_seconds: 3.95 })) }).success, false);
  const { script } = await animatedFixture();
  const { fiction: _fiction, ...factual } = script;
  assert.equal(scriptJsonSchema.safeParse({ ...factual, sources: [{ claim: "Source", source_url: "https://example.org" }] }).success, false);
});
test("animation refuses gaps, still image fallback, alternate CTA and fake extra duration", async () => {
  const { script } = await animatedFixture();
  for (const candidate of [{ ...script, gap_seconds: 0.5 }, { ...script, scenes: script.scenes.map(s => ({ ...s, animation: undefined })) },
    { ...script, scenes: script.scenes.map(s => ({ ...s, duration_seconds: 5 })) },
    { ...script, platform_ctas: { youtube: { narration_text: "Extra", commercial: false }, tiktok: { narration_text: "Extra", commercial: false }, organic_blocked_phrases: ["compre agora"] } }])
    assert.equal(scriptJsonSchema.safeParse(candidate).success, false);
});
test("changing the audiovisual identity changes the editorial hash; resolved URL does not", async () => {
  const { script } = await animatedFixture(), hash = await computeScriptHash(script);
  assert.notEqual(await computeScriptHash({ ...script, fiction: { ...script.fiction!, animation: { ...script.fiction!.animation!, profile_sha256: "f".repeat(64) } } }), hash);
  const mounted = scriptJsonSchema.parse({ ...script, scenes: script.scenes.map(s => ({ ...s,
    asset_portrait: { url: "https://example.org/private/clip.mp4", source: "system", license: "generated" } })) });
  assert.equal(await computeScriptHash(mounted), hash);
  assert.equal(isRenderReady(mounted), true);
});
