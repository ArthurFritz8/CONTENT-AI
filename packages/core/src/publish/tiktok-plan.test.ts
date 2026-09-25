import { test } from "node:test";
import { equal, throws } from "node:assert/strict";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { growthFixture } from "../testing/growth-fixture.ts";
import { applyGrowthStrategy, growthStrategySchema } from "./growth-strategy.ts";
import { scriptJsonSchema } from "../schemas/script-json.ts";
import { tiktokDirectPostPlan } from "./tiktok-plan.ts";

function fixture() {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json = scriptJsonSchema.parse(applyGrowthStrategy(snapshot.episode.script_json,
    growthStrategySchema.parse(growthFixture), undefined, snapshot.episode.id));
  const video = `https://project.supabase.co/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${"a".repeat(64)}/episode_portrait.mp4`;
  Object.assign(snapshot.episode.metadata.render_outputs, { platforms: { tiktok: { portrait: video,
    commercial: false, quality: { version: "1.0.0", decode_verified: true, duration_seconds: 75,
      size_bytes: 1000, width: 1080, height: 1920, warnings: [] } } } });
  const creator = { creator_username: "operator", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 180 };
  const choice = { privacy_level: "PUBLIC_TO_EVERYONE", title: "Gadget curioso #tecnologia",
    allow_comment: true, allow_duet: false, allow_stitch: false, music_usage_consent: true };
  return { snapshot, creator, choice, video };
}
test("TikTok direct-post plan uses approved organic file, current privacy selection and AI label", () => {
  const f = fixture();
  const plan = tiktokDirectPostPlan(f.snapshot, "https://project.supabase.co", f.creator, f.choice);
  equal(plan.videoUrl, f.video);
  equal(plan.body.post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  equal(plan.body.post_info.disable_duet, true);
  equal(plan.body.post_info.is_aigc, true);
  equal(plan.body.source_info.source, "PULL_FROM_URL");
});
test("TikTok plan refuses missing consent, unavailable privacy, blocked interaction and excessive duration", () => {
  const f = fixture();
  throws(() => tiktokDirectPostPlan(f.snapshot, "https://project.supabase.co", f.creator,
    { ...f.choice, music_usage_consent: false }));
  throws(() => tiktokDirectPostPlan(f.snapshot, "https://project.supabase.co", f.creator,
    { ...f.choice, privacy_level: "FOLLOWER_OF_CREATOR" }));
  throws(() => tiktokDirectPostPlan(f.snapshot, "https://project.supabase.co", f.creator,
    { ...f.choice, allow_duet: true }));
  throws(() => tiktokDirectPostPlan(f.snapshot, "https://project.supabase.co",
    { ...f.creator, max_video_post_duration_sec: 60 }, f.choice));
});
