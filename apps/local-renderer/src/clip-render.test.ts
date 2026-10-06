import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertClipCoverage, buildClipSceneFilterGraph, isSceneClip } from "./clip-render.ts";

test("clipe exige referência exata, cena e orientação; não seleciona versão antiga", () => {
  const clip = { type: "video_clip", url: "https://example.com/current.mp4", metadata: { scene_order: 0, orientation: "portrait" } };
  assert.equal(isSceneClip([clip], "https://example.com/current.png", 0, "portrait"), false);
  assert.equal(isSceneClip([clip], clip.url, 0, "portrait"), true);
  assert.throws(() => isSceneClip([clip], clip.url, 1, "portrait"), /inválido/);
  assert.throws(() => isSceneClip([clip], clip.url, 0, "landscape"), /inválido/);
  assert.throws(() => isSceneClip([clip, { ...clip, type: "image" }], clip.url, 0, "portrait"), /ambíguo/);
});

test("duração da faixa de vídeo deve cobrir voz e intervalo, sem usar a cauda do áudio", () => {
  const probe = { streams: [{ codec_type: "video", duration: "2", width: 90, height: 160 }], format: { duration: "10" } };
  assert.equal(assertClipCoverage(probe, 2), 2);
  assert.throws(() => assertClipCoverage(probe, 2.5), /repetição automática/);
  assert.throws(() => assertClipCoverage({ streams: [] }, 2), /duração medida/);
});

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: null });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test("FFmpeg mantém movimento e enquadramento do clipe e usa somente a narração", () => {
  const dir = mkdtempSync(join(tmpdir(), "content-ai-clip-"));
  const previousFontConfig = process.env.FONTCONFIG_FILE;
  try {
    if (process.platform === "win32") {
      const config = join(dir, "fonts.conf");
      writeFileSync(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${dir.replaceAll("\\", "/")}/fontcache</cachedir></fontconfig>`);
      process.env.FONTCONFIG_FILE = config;
    }
    const clip = join(dir, "clip.mp4"), voice = join(dir, "voice.wav"), ass = join(dir, "subtitles.ass"), output = join(dir, "scene.mp4");
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=90x160:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-c:a", "aac", clip]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", voice]);
    writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,12,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Teste\n`);
    const graph = buildClipSceneFilterGraph({ size: { width: 160, height: 90 }, subtitlePath: ass, audioDuration: 2, gapSeconds: 0.2 });
    ffmpeg(["-i", clip, "-i", voice, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-ar", "44100", output]);
    const probeResult = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" });
    assert.equal(probeResult.status, 0);
    const probe = JSON.parse(probeResult.stdout);
    assert.ok(Math.abs(Number(probe.format.duration) - 2.2) < 0.08);
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    assert.equal(video.avg_frame_rate, "30/1");
    assert.equal(video.width, 160);
    assert.equal(video.height, 90);
    const sample = (time: string, crop: string) => ffmpeg(["-ss", time, "-i", output, "-vf", crop, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    assert.notDeepEqual(sample("0.2", "crop=40:40:60:10"), sample("1.4", "crop=40:40:60:10"), "movimento original deve continuar");
    assert.ok(sample("0.2", "crop=8:8:0:0").every(value => value < 10), "retrato deve caber no horizontal com barras, sem cortar o elenco");
    const pcm = ffmpeg(["-i", output, "-t", "1", "-vn", "-ac", "1", "-ar", "44100", "-f", "s16le", "pipe:1"]);
    const energyAt = (frequency: number) => {
      let sine = 0, cosine = 0;
      for (let index = 0; index < pcm.length / 2; index++) {
        const angle = 2 * Math.PI * frequency * index / 44100;
        sine += pcm.readInt16LE(index * 2) * Math.sin(angle);
        cosine += pcm.readInt16LE(index * 2) * Math.cos(angle);
      }
      return Math.hypot(sine, cosine);
    };
    assert.ok(energyAt(440) > energyAt(880) * 10, "narração deve substituir som do clipe");
    ffmpeg(["-i", output, "-f", "null", "-"]);
  } finally {
    if (previousFontConfig === undefined) delete process.env.FONTCONFIG_FILE;
    else process.env.FONTCONFIG_FILE = previousFontConfig;
    rmSync(dir, { recursive: true, force: true });
  }
});
