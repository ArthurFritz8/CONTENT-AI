import { test } from "node:test";
import { equal, throws } from "node:assert/strict";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { growthFixture } from "../testing/growth-fixture.ts";
import {
  applyGrowthStrategy,
  growthStrategySchema,
} from "./growth-strategy.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
import { bufferTikTokPlan } from "./buffer-tiktok-plan.ts";

function fixture() {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json = scriptJsonSchema.parse(
    applyGrowthStrategy(
      snapshot.episode.script_json,
      growthStrategySchema.parse(growthFixture),
      undefined,
      snapshot.episode.id,
    ),
  );
  const video =
    `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${
      "a".repeat(64)
    }/episode_portrait.mp4`;
  Object.assign(snapshot.episode.metadata.render_outputs, {
    platforms: {
      tiktok: {
        portrait: video,
        commercial: false,
        quality: {
          version: "1.0.0",
          decode_verified: true,
          duration_seconds: 75,
          size_bytes: 1000,
          width: 1080,
          height: 1920,
          warnings: [],
        },
      },
    },
  });
  return { snapshot, video };
}

test("Buffer plan uses only immutable, reviewed, vertical organic media", () => {
  const { snapshot, video } = fixture();
  const plan = bufferTikTokPlan(snapshot, "https://project.supabase.co");
  equal(plan.videoUrl, video);
  equal(plan.isAiGenerated, true);
  equal(plan.caption.includes("#"), true);
});

test("Buffer plan rejects commercial, unverified, oversize and landscape media", () => {
  const { snapshot } = fixture();
  const render = (snapshot.episode.metadata.render_outputs as unknown as {
    platforms: {
      tiktok: {
        quality: Record<string, unknown>;
        portrait: string;
      };
    };
  }).platforms.tiktok;
  render.quality.height = 720;
  throws(
    () => bufferTikTokPlan(snapshot, "https://project.supabase.co"),
    /vertical/,
  );
  render.quality.height = 1920;
  render.quality.size_bytes = 1_000_000_001;
  throws(() => bufferTikTokPlan(snapshot, "https://project.supabase.co"));
  render.quality.size_bytes = 1000;
  render.portrait = "https://elsewhere.example/video.mp4";
  throws(
    () => bufferTikTokPlan(snapshot, "https://project.supabase.co"),
    /Storage/,
  );
  render.portrait =
    `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${
      "a".repeat(64)
    }/episode_portrait.mp4`;
  snapshot.episode.script_json.disclosures.commercial_content = true;
  throws(() => bufferTikTokPlan(snapshot, "https://project.supabase.co"));
});
