import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { animatedFixture } from "../../../packages/core/src/testing/animated-fixture.ts";
import { renderAnimatedChapter } from "./animated-render.ts";

test("real FFmpeg joins all five shots without losing 60 FPS, frames or the original PCM", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "animated-montage-test-"));
  try {
    const { script } = await animatedFixture(), path = join(directory, "clip.mp4"), audioPath = join(directory, "speech.wav"), otherAudio = join(directory, "reply.wav");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=704x1280:r=60", "-frames:v", "237",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", path], { windowsHide: true });
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "1", "-c:a", "pcm_s16le", "-ac", "1", audioPath], { windowsHide: true });
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=16000", "-t", "1", "-c:a", "pcm_s16le", "-ac", "1", otherAudio], { windowsHide: true });
    const sha256 = createHash("sha256").update(await readFile(path)).digest("hex"), audio_sha256 = createHash("sha256").update(await readFile(audioPath)).digest("hex");
    const replyHash = createHash("sha256").update(await readFile(otherAudio)).digest("hex");
    const takes = script.scenes.map((scene, i) => {
      const audio = i % 2 ? { audioPath: otherAudio, audio_sha256: replyHash } : { audioPath, audio_sha256 };
      scene.animation!.audio_sha256 = audio.audio_sha256;
      return { path, sha256, ...audio };
    });
    const result = await renderAnimatedChapter(script, takes, directory);
    assert.equal(result.quality.frame_count, 1185);
    assert.equal(result.quality.fps, 60);
    assert.equal(result.quality.duration_seconds, 19.75);
    assert.equal(result.quality.decode_verified, true);
    assert.equal(result.quality.lip_sync_validated, false);
    const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", result.path, "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], { windowsHide: true });
    const energy = (start: number, frequency: number) => {
      let real = 0, imaginary = 0;
      for (let n = 0; n < 4000; n++) {
        const value = pcm.readInt16LE(2 * (Math.round(start * 16000) + n)), angle = 2 * Math.PI * frequency * n / 16000;
        real += value * Math.cos(angle); imaginary += value * Math.sin(angle);
      }
      return real * real + imaginary * imaginary;
    };
    for (let i = 0; i < 5; i++) {
      const time = i * 3.95 + 0.25, frequency = i % 2 ? 880 : 440;
      assert.ok(energy(time, frequency) > energy(time, frequency === 440 ? 880 : 440) * 10, `PCM begins with the correct voice at cut ${i}`);
      assert.ok(energy(i * 3.95 + 2, frequency) < energy(time, frequency) * 0.001, "remaining motion has silence, no stretched/repeated speech");
    }
    await assert.rejects(renderAnimatedChapter(script, takes.slice(1), directory), /todas as tomadas/);
    await assert.rejects(renderAnimatedChapter(script, [{ ...takes[0]!, sha256: "0".repeat(64) }, ...takes.slice(1)], directory), /alterado/);
    await writeFile(audioPath, Buffer.from("invalid WAV"));
    await assert.rejects(renderAnimatedChapter(script, takes, directory), /alterado/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
