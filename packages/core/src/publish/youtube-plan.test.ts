import { test } from "node:test";
import { equal, throws } from "node:assert/strict";
import { youtubePrivatePlan } from "./youtube-plan.ts";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
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
