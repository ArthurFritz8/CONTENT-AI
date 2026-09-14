import { test } from "node:test";
import assert from "node:assert/strict";
import { assessMedia, assertMatchingDurations, type MediaProbe } from "./media-quality.ts";

function valid(): MediaProbe {
  return { format: { duration: "10.05", size: "42000" }, streams: [
    { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "30/1", duration: "10.03" },
    { codec_type: "audio", codec_name: "aac", duration: "10.02" },
  ] };
}

test("QA aceita arredondamento AAC e distingue duração real do alvo editorial", () => {
  const report = assessMedia(valid(), "landscape", 10, 60);
  assert.equal(report.duration_seconds, 10.05);
  assert.equal(report.warnings.length, 1);
  assert.equal(assessMedia(valid(), "landscape", 10, 10).warnings.length, 0);
  const rounded = valid(); rounded.streams![0]!.avg_frame_rate = "2998/100";
  assert.equal(assessMedia(rounded, "landscape", 10, 10).fps, 29.98);
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
    assert.throws(() => assessMedia(probe, "landscape", 10, 10), /QA audiovisual/);
  }
});

test("QA compara os dois formatos antes de disponibilizar finais", () => {
  assertMatchingDurations(10, 10.1);
  assert.throws(() => assertMatchingDurations(10, 12), /durações/);
  assert.throws(() => assertMatchingDurations(NaN, 10), /durações/);
});
