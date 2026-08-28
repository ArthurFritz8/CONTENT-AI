import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  buildConcatList,
  conventionalSceneAudioPath,
  conventionalWordBoundariesPath,
  escapeConcatPath,
  escapeFfmpegFilterPath,
  finalRenderPath,
  padSceneOrder,
  sceneIntermediatePath,
  sceneProgress,
  selectAudioUrlForScene,
  storagePublicUrl,
} from "./render-utils.ts";

test("paths do renderer seguem convenção estável por cena", () => {
  strictEqual(padSceneOrder(4), "004");
  strictEqual(
    sceneIntermediatePath("ep", 4, "portrait"),
    "episodes/ep/render/intermediate/scene_004_portrait.mp4",
  );
  strictEqual(finalRenderPath("ep", "landscape"), "episodes/ep/render/final/episode_landscape.mp4");
  strictEqual(conventionalSceneAudioPath("ep", 4), "episodes/ep/audio/scene_004.mp3");
  strictEqual(
    conventionalWordBoundariesPath("ep", 4),
    "episodes/ep/audio/scene_004_word_boundaries.json",
  );
});

test("sceneProgress aplica percentual por cena concluída", () => {
  deepStrictEqual([sceneProgress(0, 4), sceneProgress(1, 4), sceneProgress(4, 4)], [0, 25, 100]);
  strictEqual(sceneProgress(5, 4), 100);
  strictEqual(sceneProgress(1, 0), 0);
});

test("escapes para concat demuxer e filtros FFmpeg", () => {
  strictEqual(escapeConcatPath("/tmp/a'b.mp4"), "/tmp/a'\\''b.mp4");
  strictEqual(escapeFfmpegFilterPath("C:\\tmp\\a'b.ass"), "C\\:/tmp/a\\'b.ass");
});

test("storagePublicUrl codifica segmentos sem quebrar barras", () => {
  strictEqual(
    storagePublicUrl("https://example.supabase.co/", "assets", "episodes/ep/a b.mp4"),
    "https://example.supabase.co/storage/v1/object/public/assets/episodes/ep/a%20b.mp4",
  );
});

test("selectAudioUrlForScene aceita convenções com pad e sem pad", () => {
  const assets = [
    { url: "https://cdn/audio/scene_001.mp3" },
    { url: "https://cdn/audio/scene-4.mp3" },
  ];
  strictEqual(selectAudioUrlForScene(assets, 1), assets[0]!.url);
  strictEqual(selectAudioUrlForScene(assets, 4), assets[1]!.url);
  strictEqual(selectAudioUrlForScene(assets, 9), null);
});

test("buildConcatList gera arquivo aceito pelo concat demuxer", () => {
  strictEqual(buildConcatList(["/tmp/a.mp4", "/tmp/b.mp4"]), "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n");
});