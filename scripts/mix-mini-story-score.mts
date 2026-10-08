/** Reuse renderer ducking and copy the video bitstream; no providers or publication. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildMusicMixFilter } from "../apps/local-renderer/src/render-utils.ts";

const out = resolve(import.meta.dirname, "../output/complete-mini-story");
const assembly = JSON.parse(await readFile(join(out, "assembly.json"), "utf8"));
const license = JSON.parse(await readFile(join(out, "score-license.json"), "utf8"));
const score = join(out, "original-score.wav"), original = join(out, "a-mala-na-porta-completa.mp4");
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
if (assembly.completion_mode !== "one-new-reveal" || license.license !== "own" || license.source !== "system" ||
  license.external_samples !== false || hash(await readFile(score)) !== license.sha256 ||
  hash(await readFile(original)) !== assembly.sha256 || license.fade_out_ends_at_seconds !== assembly.seconds)
  throw new Error("Verified master and original score required");
const filename = "a-mala-na-porta-completa-trilha.mp4", target = join(out, filename);
const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-copyts", "-i", original, "-i", score,
  "-filter_complex", buildMusicMixFilter(.08), "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
  "-c:a", "aac", "-b:a", "96k", "-ar", "16000", "-avoid_negative_ts", "disabled", "-movflags", "+faststart", target],
  { encoding: "utf8", timeout: 60_000 });
if (result.status !== 0) throw new Error(`Score mix failed: ${result.stderr}`);
await writeFile(join(out, "score-mix.json"), JSON.stringify({ filename, sha256: hash(await readFile(target)),
  original_master_sha256: assembly.sha256, score_sha256: license.sha256, score_license: "own", music_volume: .08,
  sidechain_ducking: true, video_bitstream_copied: true, new_cloud_calls: 0, production_enabled: false, published: false }, null, 2));
process.stdout.write(JSON.stringify({ event: "scored_preview_ready", path: target, video_bitstream_copied: true }) + "\n");
