import { test } from "node:test";
import assert from "node:assert/strict";
import { assessMedia, assertMatchingDurations, type MediaProbe } from "./media-quality.ts";

function valid(): MediaProbe {
  return { format: { duration: "65.05", size: "42000" }, streams: [
    { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1", duration: "65.03" },
    { codec_type: "audio", codec_name: "aac", duration: "65.02" },
  ] };
}

test("QA aceita arredondamento AAC e reprova duração real abaixo do contrato", () => {
  const report = assessMedia(valid(), "landscape", 65, 60);
  assert.equal(report.duration_seconds, 65.05);
  assert.equal(report.warnings.length, 0);
  const short = valid(); short.format!.duration = "35.05";
  short.streams![0]!.duration = "35.03";
  short.streams![1]!.duration = "35.02";
  assert.throws(() => assessMedia(short, "landscape", 35, 65), /duração real abaixo/);
  assert.equal(assessMedia(valid(), "landscape", 65, 65).warnings.length, 0);
  const rounded = valid(); rounded.streams![0]!.avg_frame_rate = "2998/100";
  assert.equal(assessMedia(rounded, "landscape", 65, 65).fps, 29.98);
});

test("QA impede vídeo sem áudio, truncado, resolução/codec/FPS incorretos e metadados inválidos", () => {
  const mutations: Array<(probe: MediaProbe) => void> = [
    p => { p.streams!.pop(); },
    p => { p.streams![1]!.duration = "3"; },
    p => { p.streams![0]!.width = 1080; },
    p => { p.streams![0]!.codec_name = "hevc"; },
    p => { p.streams![0]!.pix_fmt = "yuv444p"; },
    p => { p.streams![0]!.avg_frame_rate = "0/0"; },
    p => { p.streams![0]!.avg_frame_rate = "24/1"; },
    p => { p.format!.duration = "7"; },
    p => { p.format!.duration = "NaN"; },
    p => { p.format!.size = "0"; },
    p => { p.streams!.push({ ...p.streams![1]! }); },
  ];
  for (const mutate of mutations) {
    const probe = valid(); mutate(probe);
    assert.throws(() => assessMedia(probe, "landscape", 65, 65), /QA audiovisual/);
  }
});

test("QA compara os dois formatos antes de disponibilizar finais", () => {
  assertMatchingDurations(10, 10.1);
  assert.throws(() => assertMatchingDurations(10, 12), /durações/);
  assert.throws(() => assertMatchingDurations(NaN, 10), /durações/);
});
