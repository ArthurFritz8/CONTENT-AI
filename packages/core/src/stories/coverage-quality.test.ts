import { test } from "node:test";
import { ok, strictEqual } from "node:assert";
import { assessStoryCoverage } from "./coverage-quality.ts";
test("the old 19% animated preview cannot pass as a fully animated story", () => {
  const durations = [1.4,3.25,4.083333,2.2,3.8,2.4];
  const report = assessStoryCoverage({ profile: "animated_story", shots: durations.map((seconds, i) => ({
    id: String(i), seconds, motion: i === 1 ? "generated" : "camera_only", function: i === 0 || i === 5 ? "detail" : "dialogue",
    speaker_visible: i === 1, body_action_reviewed: false, listener_reaction_reviewed: false,
  })) });
  strictEqual(report.passed, false); ok(report.animated_fraction < .2); ok(report.findings.length >= 4);
});
test("camera motion and high output FPS never substitute for reviewed body animation", () => {
  const report = assessStoryCoverage({ profile: "animated_story", shots: [{ id: "a", seconds: 3,
    motion: "camera_only", function: "reaction", speaker_visible: true, body_action_reviewed: true, listener_reaction_reviewed: true }] });
  strictEqual(report.passed, false);
});
test("a well-covered animated scene passes coverage, still requiring lipsync/anatomy review", () => {
  const report = assessStoryCoverage({ profile: "animated_story", shots: [
    { id: "a", seconds: 3, motion: "generated", function: "action", speaker_visible: false, body_action_reviewed: true, listener_reaction_reviewed: true },
    { id: "b", seconds: 4, motion: "generated", function: "dialogue", speaker_visible: true, body_action_reviewed: false, listener_reaction_reviewed: false },
    { id: "c", seconds: 1, motion: "still", function: "detail", speaker_visible: false, body_action_reviewed: false, listener_reaction_reviewed: false },
  ] });
  strictEqual(report.passed, true); strictEqual(report.lip_sync_certified, false); strictEqual(report.artistic_review_required, true);
});
