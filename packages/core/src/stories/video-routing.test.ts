import { test } from "node:test";
import { strictEqual, deepStrictEqual, throws } from "node:assert";
import { routeVideoShot, canFallback, type VideoProvider } from "./video-routing.ts";

const now = 1000000;
const shot = { version: "1.0.0", id: "reaction", kind: "reaction", reference_path: "own.png",
  reference_sha256: "a".repeat(64), prompt: "A personagem se vira para a porta e recua surpresa.", seconds: 3,
  seed: 42, quality: "preview", min_short_edge: 480, min_output_fps: 16 };
const provider = (id = "one", group = id): VideoProvider => ({ id, quota_group: group, capabilities: ["reaction", "action"],
  quality: ["preview"], short_edge: 480, output_fps: 16, max_seconds: 5, available: true, checked_at: now,
  cooldown_until: 0, free_remaining: 3, reserved: 0, required: 1, cash_cost: 0, adapter_ready: true, billing: "credits" });
test("routes to another independent free provider when quota is exhausted", () => {
  const first = { ...provider(), free_remaining: 0 };
  strictEqual(routeVideoShot(shot, [first, provider("two")], now).selected, "two");
});
test("does not count two endpoints sharing an account as independent fallback quotas", () => {
  const result = routeVideoShot(shot, [provider("a", "shared"), provider("b", "shared"), provider("c")], now);
  deepStrictEqual(result.alternatives, ["c"]);
});
test("unknown credits, paid use, stale balance, reservations and cooldown all fail closed", () => {
  for (const change of [{ free_remaining: null }, { cash_cost: .001 }, { checked_at: now - 300001 },
    { checked_at: now + 1 }, { reserved: 3 }, { cooldown_until: now + 1 }, { required: NaN }, { adapter_ready: false }])
    strictEqual(routeVideoShot(shot, [{ ...provider(), ...change }], now).selected, null);
});
test("non-billable shared demo can be attempted with unknown quota without inventing a video count", () => {
  const p = { ...provider(), billing: "free_service" as const, free_remaining: null };
  strictEqual(routeVideoShot(shot, [p], now).selected, "one");
  strictEqual(p.free_remaining, null);
});
test("I2V never replaces lipsync, native FPS or an approved master", () => {
  for (const change of [{ kind: "dialogue", audio_sha256: "b".repeat(64) }, { min_output_fps: 24 },
    { quality: "approved_master" }, { min_short_edge: 704 }])
    strictEqual(routeVideoShot({ ...shot, ...change }, [provider()], now).selected, null);
  throws(() => routeVideoShot({ ...shot, kind: "dialogue" }, [provider()], now));
});
test("only confirmed rejection before acceptance permits automatic fallback", () => {
  strictEqual(canFallback("rejected_before_acceptance"), true);
  for (const outcome of ["accepted", "unknown", "completed"] as const) strictEqual(canFallback(outcome), false);
});
