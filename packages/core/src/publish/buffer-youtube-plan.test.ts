import { test } from "node:test";
import { equal, throws } from "node:assert/strict";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { growthFixture } from "../testing/growth-fixture.ts";
import { applyGrowthStrategy, growthStrategySchema } from "./growth-strategy.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
import { bufferYoutubePlan } from "./buffer-youtube-plan.ts";

const config = { max_video_bytes: 52_428_800, made_for_kids: false, category_ids: { Education: "27" } };
function fixture() {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json = scriptJsonSchema.parse(applyGrowthStrategy(snapshot.episode.script_json,
    growthStrategySchema.parse(growthFixture), undefined, snapshot.episode.id));
  const url = `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${"a".repeat(64)}/episode_portrait.mp4`;
  snapshot.episode.render_url = url;
  snapshot.episode.metadata.render_outputs.portrait = url;
  Object.assign(snapshot.episode.metadata.render_outputs, {
    quality: { portrait: { decode_verified: true, duration_seconds: 80, size_bytes: 5_000_000,
      width: 1080, height: 1920 } },
    platforms: { tiktok: { portrait: url, commercial: false, quality: { version: "1.0.0",
      decode_verified: true, duration_seconds: 80, size_bytes: 5_000_000,
      width: 1080, height: 1920, warnings: [] } }, youtube: { portrait: url } },
  });
  return { snapshot, url };
}

test("Buffer YouTube plan keeps approved organic Short metadata and exact portrait", () => {
  const { snapshot, url } = fixture();
  const plan = bufferYoutubePlan(snapshot, config, "https://project.supabase.co");
  equal(plan.videoUrl, url);
  equal(plan.title, snapshot.episode.script_json.metadata.youtube.title);
  equal(plan.categoryId, "27");
  equal(plan.madeForKids, false);
});

test("Buffer YouTube rejects long or non-9:16 video and commercial CTA", () => {
  const { snapshot } = fixture();
  const quality = (snapshot.episode.metadata.render_outputs as any).quality.portrait;
  quality.duration_seconds = 181;
  throws(() => bufferYoutubePlan(snapshot, config, "https://project.supabase.co"));
  quality.duration_seconds = 80;
  quality.width = 1078;
  throws(() => bufferYoutubePlan(snapshot, config, "https://project.supabase.co"), /9:16/);
  quality.width = 1080;
  snapshot.episode.script_json.platform_ctas!.youtube.commercial = true;
  throws(() => bufferYoutubePlan(snapshot, config, "https://project.supabase.co"));
});
