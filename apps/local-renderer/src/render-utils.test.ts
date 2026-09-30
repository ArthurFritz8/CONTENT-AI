import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  buildConcatList,
  buildMusicMixFilter,
  conventionalSceneAudioPath,
  conventionalWordBoundariesPath,
  escapeConcatPath,
  escapeFfmpegFilterPath,
  finalRenderPath,
  isMissingOptionalStorageObject,
  isTransientStorageStatus,
  padSceneOrder,
  plannedRenderedDuration,
  planShotDurations,
  motionForShot,
  zoomPanFilter,
  sceneIntermediatePath,
  sceneProgress,
  selectAssetUrlForScene,
  selectAudioUrlForScene,
  storagePublicUrl,
} from "./render-utils.ts";

test("planejamento visual limita tomadas e usa o movimento pedido pelo roteiro", () => {
  deepStrictEqual(planShotDurations(2.5, 3), [2.5]);
  deepStrictEqual(planShotDurations(12, 3), [4, 4, 4]);
  strictEqual(motionForShot("static", 2), "static");
  strictEqual(motionForShot("in", 1), "pan_right");
  const left = zoomPanFilter("pan_left", 120, { width: 1080, height: 1920 });
  const right = zoomPanFilter("pan_right", 120, { width: 1080, height: 1920 });
  strictEqual(left.includes("1-min(on/120,1)"), true);
  strictEqual(right.includes("min(on/120,1)"), true);
});

test("pré-verificação soma áudio medido e detecta cena sem duração", () => {
  const assets = [
    { type: "audio", url: "https://cdn/0.mp3", metadata: { scene_order: 0, duration_seconds: 20 } },
    { type: "audio", url: "https://cdn/1.mp3", metadata: { scene_order: 1, duration_seconds: 21 } },
  ];
  strictEqual(plannedRenderedDuration([0, 1], assets, 0.5), 42);
  strictEqual(plannedRenderedDuration([0], assets, 0.5), 20.5);
  throws(() => plannedRenderedDuration([0, 2], assets, 0.5), /Áudio da cena 2/);
});

test("música baixa sob a voz e usa volume validado", () => {
  const filter = buildMusicMixFilter(0.08);
  strictEqual(filter.includes("volume=0.08"), true);
  strictEqual(filter.includes("sidechaincompress"), true);
  throws(() => buildMusicMixFilter(1.2), RangeError);
});

test("paths do renderer seguem convenção estável por cena", () => {
  strictEqual(padSceneOrder(4), "004");
  strictEqual(
    sceneIntermediatePath("ep", 4, "portrait"),
    "episodes/ep/render/intermediate/scene_004_portrait.mp4",
  );
  strictEqual(finalRenderPath("ep", "landscape", "revision"), "episodes/ep/render/final/revision/episode_landscape.mp4");
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

test("arquivo opcional ausente aceita 404 direto e envelope 400 do Storage", () => {
  strictEqual(isMissingOptionalStorageObject(404, "not found"), true);
  strictEqual(isMissingOptionalStorageObject(400, '{"statusCode":"404","code":"NoSuchKey"}'), true);
  strictEqual(isMissingOptionalStorageObject(400, '{"statusCode":"400","code":"InvalidKey"}'), false);
  strictEqual(isMissingOptionalStorageObject(500, '{"statusCode":"404"}'), false);
});

test("upload repete somente respostas transitórias do Storage", () => {
  strictEqual(isTransientStorageStatus(408), true);
  strictEqual(isTransientStorageStatus(429), true);
  strictEqual(isTransientStorageStatus(520), true);
  strictEqual(isTransientStorageStatus(400), false);
  strictEqual(isTransientStorageStatus(404), false);
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

test("selectAssetUrlForScene prioriza metadata de cena e orientação", () => {
  const assets = [
    { type: "subtitle", url: "https://cdn/scene_001_portrait.ass", metadata: { scene_order: 1, orientation: "portrait" } },
    { type: "subtitle", url: "https://cdn/scene_001_landscape.ass", metadata: { scene_order: 1, orientation: "landscape" } },
  ];
  strictEqual(selectAssetUrlForScene(assets, 1, "subtitle", "portrait"), assets[0]!.url);
  strictEqual(selectAssetUrlForScene(assets, 1, "subtitle", "landscape"), assets[1]!.url);
  strictEqual(selectAssetUrlForScene(assets, 2, "subtitle", "portrait"), null);
});

test("buildConcatList gera arquivo aceito pelo concat demuxer", () => {
  strictEqual(buildConcatList(["/tmp/a.mp4", "/tmp/b.mp4"]), "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n");
});
