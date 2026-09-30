import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMusicMixFilter, buildSceneFilterGraph, planShotDurations } from "./render-utils.ts";

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: null });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test("FFmpeg alterna as fotos no tempo da narração e grava som e legenda", () => {
  const dir = mkdtempSync(join(tmpdir(), "content-ai-shots-"));
  const previousFontConfig = process.env.FONTCONFIG_FILE;
  try {
    if (process.platform === "win32") {
      const fontConfig = join(dir, "fonts.conf");
      writeFileSync(fontConfig, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${dir.replaceAll("\\", "/")}/fontcache</cachedir></fontconfig>`);
      process.env.FONTCONFIG_FILE = fontConfig;
    }
    const red = join(dir, "red.bmp");
    const blue = join(dir, "blue.bmp");
    const audio = join(dir, "audio.wav");
    const ass = join(dir, "subtitles.ass");
    const output = join(dir, "scene.mp4");
    ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=160x90", "-frames:v", "1", red]);
    ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=160x90", "-frames:v", "1", blue]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", audio]);
    writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,12,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:06.00,Default,,0,0,0,,Teste\n`);
    const durations = planShotDurations(6, 2);
    const graph = buildSceneFilterGraph({ shotDurations: durations, motion: "pan_right", size: { width: 160, height: 90 }, subtitlePath: ass, audioDuration: 6, gapSeconds: 0 });
    ffmpeg(["-loop", "1", "-i", red, "-loop", "1", "-i", blue, "-i", audio,
      "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", output]);
    const sample = (time: string) => ffmpeg(["-ss", time, "-i", output, "-vf", "crop=2:2:80:24", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    const first = sample("1");
    const second = sample("4");
    assert.ok(first[0]! > first[2]! + 100, "primeira tomada deve ser vermelha");
    assert.ok(second[2]! > second[0]! + 100, "segunda tomada deve ser azul");
  } finally {
    if (previousFontConfig === undefined) delete process.env.FONTCONFIG_FILE;
    else process.env.FONTCONFIG_FILE = previousFontConfig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FFmpeg mistura trilha com compressão acionada pela voz", () => {
  const dir = mkdtempSync(join(tmpdir(), "content-ai-music-"));
  try {
    const voice = join(dir, "voice.wav");
    const music = join(dir, "music.wav");
    const output = join(dir, "mix.wav");
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", voice]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=2", music]);
    ffmpeg(["-i", voice, "-i", music, "-filter_complex", buildMusicMixFilter(0.12), "-map", "[a]", output]);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output], { encoding: "utf8" });
    assert.equal(probe.status, 0);
    assert.ok(Math.abs(Number(probe.stdout.trim()) - 2) < 0.1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
