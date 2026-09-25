import { test } from "node:test";
import { equal, throws } from "node:assert/strict";
import { youtubePlan, youtubePrivatePlan } from "./youtube-plan.ts";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { growthFixture } from "../testing/growth-fixture.ts";
import { applyGrowthStrategy, growthStrategySchema } from "./growth-strategy.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
function fixture() {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.metadata.render_outputs.landscape = `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${"a".repeat(64)}/episode_landscape.mp4`;
  return snapshot;
}
const cfg = { max_video_bytes: 52428800, made_for_kids: false, category_ids: { Education: "27" } };
test("private plan preserves approved metadata and required disclosures", () => {
  const snapshot = fixture();
  const plan = youtubePrivatePlan(snapshot, cfg, "https://project.supabase.co");
  equal(plan.body.snippet.title, snapshot.episode.script_json.metadata.youtube.title);
  equal(plan.body.snippet.description, snapshot.episode.script_json.metadata.youtube.description);
  equal(plan.body.status.privacyStatus, "private");
  equal(plan.body.status.containsSyntheticMedia, true);
  equal(plan.body.snippet.categoryId, "27");
});
test("private plan refuses unknown categories, byte limits and altered storage paths", () => {
  throws(() => youtubePrivatePlan(fixture(), { ...cfg, category_ids: {} }, "https://project.supabase.co"));
  for (const url of ["https://evil.test/video.mp4", "https://project.supabase.co/storage/v1/object/public/assets/old.mp4", `${fixture().episode.metadata.render_outputs.landscape}?token=secret`]) {
    const snapshot = fixture(); snapshot.episode.metadata.render_outputs.landscape = url;
    throws(() => youtubePrivatePlan(snapshot, cfg, "https://project.supabase.co"));
  }
  const snapshot = fixture(); snapshot.episode.script_json.metadata.youtube.description = "é".repeat(3000);
  throws(() => youtubePrivatePlan(snapshot, cfg, "https://project.supabase.co"), /contrato YouTube/);
});

test("public Short uses approved organic portrait and refuses commercial or unbound media", () => {
  const snapshot = fixture();
  const portrait = `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${"b".repeat(64)}/episode_portrait.mp4`;
  snapshot.episode.metadata.render_outputs.portrait = portrait;
  snapshot.episode.render_url = portrait;
  snapshot.episode.script_json = scriptJsonSchema.parse(applyGrowthStrategy(snapshot.episode.script_json,
    growthStrategySchema.parse(growthFixture), undefined, snapshot.episode.id));
  Object.assign(snapshot.episode.metadata.render_outputs, { platforms: { tiktok: { portrait: "https://example.com/tiktok.mp4",
    commercial: false, quality: { version: "1.0.0", decode_verified: true, duration_seconds: 70,
      size_bytes: 1000, width: 1080, height: 1920, warnings: [] } } } });
  const target = { variant: "portrait" as const, privacy: "public" as const };
  const plan = youtubePlan(snapshot, cfg, "https://project.supabase.co", target);
  equal(plan.url, portrait);
  equal(plan.body.status.privacyStatus, "public");
  equal(plan.body.paidProductPlacementDetails.hasPaidProductPlacement, false);
  snapshot.episode.script_json.platform_ctas!.youtube.commercial = true;
  throws(() => youtubePlan(snapshot, cfg, "https://project.supabase.co", target));
  snapshot.episode.script_json.platform_ctas!.youtube.commercial = false;
  snapshot.episode.metadata.render_outputs.portrait = snapshot.episode.metadata.render_outputs.landscape;
  throws(() => youtubePlan(snapshot, cfg, "https://project.supabase.co", target));
});
