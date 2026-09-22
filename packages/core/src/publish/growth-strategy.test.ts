import { test } from "node:test";
import { strictEqual, notStrictEqual, throws, ok } from "node:assert";
import { makeValidScript } from "../testing/script-fixture.ts";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { growthFixture } from "../testing/growth-fixture.ts";
import { applyGrowthStrategy, growthStrategySchema, platformMediaScenes } from "./growth-strategy.ts";
import { applyAffiliateMetadata } from "./affiliate-metadata.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
import { createScriptQualityChecker } from "../validators/script-quality.ts";
import { computeScriptHash } from "../validators/hash-utils.ts";
import { validateReviewSnapshot } from "../review/review-packet.ts";

const config = growthStrategySchema.parse(growthFixture);
function make(link?: string) {
  const raw = makeValidScript();
  return scriptJsonSchema.parse(applyAffiliateMetadata(
    applyGrowthStrategy(raw, config, link, raw.episode_id),
    { youtube: link, tiktok: "https://example.com/tiktok-affiliate" }, Boolean(link)));
}
test("growth uses commercial YouTube ending only with validated destination link", () => {
  const organic = make();
  strictEqual(organic.platform_ctas!.youtube.commercial, false);
  strictEqual(organic.platform_ctas!.youtube.narration_text, organic.platform_ctas!.tiktok.narration_text);
  const script = make("https://amazon.example/product?tag=validated");
  ok(script.metadata.youtube.description.includes("tag=validated"));
  strictEqual(script.metadata.tiktok.description, "Descrição TikTok");
  ok(script.platform_ctas!.youtube.narration_text.includes(config.disclosure));
  const scenes = platformMediaScenes(script);
  strictEqual(scenes.length, 4);
  strictEqual(scenes[3]!.order, 3);
  strictEqual(scenes[3]!.narration_text, script.platform_ctas!.tiktok.narration_text);
  notStrictEqual(scenes[3]!.narration_text, scenes[2]!.narration_text);
  strictEqual(platformMediaScenes(makeValidScript()).length, 3);
});
test("growth QA rejects sales leaking into shared body, visuals, organic CTA and hashtags", () => {
  const check = createScriptQualityChecker(makeReviewSnapshot().fact_check);
  const research = makeReviewSnapshot().episode.research_data;
  strictEqual(check(make("https://amazon.example/item"), research, true).passed, true);
  for (const leak of ["body", "visual", "cta", "hashtags"]) {
    const script = make("https://amazon.example/item");
    if (leak === "body") script.scenes[0]!.narration_text = "Compre pelo link no perfil";
    if (leak === "visual") script.scenes[2]!.visual.description = "Cupom de desconto";
    if (leak === "cta") script.platform_ctas!.tiktok.narration_text = "Link na bio";
    if (leak === "hashtags") script.metadata.tiktok.hashtags.push("#afiliado");
    ok(check(script, research, true).findings.some(f => f.code === "ORGANIC_COMMERCIAL_LEAK"));
  }
});
test("organic CTA changes invalidate editorial hash and review requires its verified media", async () => {
  const script = make();
  const before = await computeScriptHash(script);
  script.platform_ctas!.tiktok.narration_text = "Conte sua experiência nos comentários.";
  notStrictEqual(await computeScriptHash(script), before);
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json = scriptJsonSchema.parse(applyGrowthStrategy(snapshot.episode.script_json, config, undefined, script.episode_id));
  throws(() => validateReviewSnapshot(snapshot), /TikTok/);
  const outputs = snapshot.episode.metadata.render_outputs;
  const withMedia = { ...snapshot, episode: { ...snapshot.episode, metadata: { render_outputs: {
    ...outputs, platforms: { tiktok: { portrait: "https://example.com/organic.mp4", commercial: false,
      quality: { version: "1.0.0", decode_verified: true, duration_seconds: 60, size_bytes: 1000, width: 1080, height: 1920, warnings: [] } } },
  } } } };
  strictEqual(validateReviewSnapshot(withMedia).report.passed, true);
  withMedia.episode.metadata.render_outputs.platforms.tiktok.quality.decode_verified = false;
  throws(() => validateReviewSnapshot(withMedia));
});
