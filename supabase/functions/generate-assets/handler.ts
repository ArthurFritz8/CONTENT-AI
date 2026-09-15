import { downloadImage } from "../_shared/asset-download.ts";
import { claimEpisode } from "../_shared/episode-lease.ts";
import { requireServiceRole } from "../_shared/auth.ts";
// generate-assets — script → assets (ADR-012): imagens + TTS + legendas com checkpoints internos.
// O estado assets significa que tudo que o renderer precisa já existe.

import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import {
  assertGeminiBudget,
  getGeminiBudgetRemaining,
  recordGeminiCall,
} from "../_shared/budget-guard.ts";
import { geminiGenerateImage } from "../_shared/gemini.ts";
import { pickPresenterPhoto, type SpokesmodelConfig } from "../../../packages/core/src/planners/spokesmodel-plan.ts";
import { searchPexelsPhoto } from "../_shared/pexels.ts";
import { markEpisodeFailed } from "../_shared/episode-utils.ts";
import { loadScriptQualityChecker, recordScriptQuality } from "../_shared/script-quality.ts";
import { researchDataSchema } from "../../../packages/core/src/schemas/research.ts";
import { researchMatchesEvidence } from "../../../packages/core/src/validators/research-evidence.ts";
import { computeScriptHash } from "../../../packages/core/src/validators/hash-utils.ts";
import {
  normalizeTtsChain,
  sourceForTtsEngine,
  synthesizeTts,
  type TtsConfig,
  type TtsEngine,
  type TtsResult,
  type TtsWordBoundary,
} from "../_shared/tts.ts";
import {
  type AssetRef,
  isRenderReady,
  type Scene,
  scriptJsonSchema,
} from "../../../packages/core/src/schemas/script-json.ts";
import { exceedsDurationDeviation } from "../../../packages/core/src/validators/duration.ts";
import { planAssetSources } from "../../../packages/core/src/planners/asset-plan.ts";
import {
  buildAssSubtitles,
  SUBTITLE_STYLE_LANDSCAPE,
  SUBTITLE_STYLE_PORTRAIT,
} from "../../../packages/core/src/subtitles/ass-builder.ts";
import { resolveWordTimings } from "../../../packages/core/src/subtitles/subtitle-timing.ts";

const inputSchema = z.object({ episode_id: z.string().uuid() });
const ORIENTATIONS = ["landscape", "portrait"] as const;
type Orientation = typeof ORIENTATIONS[number];

interface EpisodeRow {
  id: string;
  status: string;
  script_json: unknown;
  product_image_url: string | null;
  product_compliance?: { image_rights_confirmed?: boolean } | null;
  tts_engine: TtsEngine | null;
}

interface AssetsConfig {
  image_generation_enabled?: boolean;
  image_model?: string;
  storage_bucket?: string;
  pexels_fallback_query?: string;
  affiliate_image_max_bytes?: number;
  affiliate_image_hosts?: string[];
}

type AssetType = "image" | "audio" | "subtitle" | "music" | "video_clip";
type AssetSource = AssetRef["source"];

interface ExistingAsset {
  type: AssetType;
  url: string;
  license: AssetRef["license"];
  source: AssetSource;
  author: string | null;
  metadata: Record<string, unknown> | null;
}

interface AssetRowInsert extends ExistingAsset {
  episode_id: string;
}

interface AudioInfo {
  scene_order: number;
  url: string;
  tts_engine: TtsEngine;
  duration_seconds: number;
  word_boundaries: TtsWordBoundary[] | null;
}

function padSceneOrder(order: number): string {
  return String(order).padStart(3, "0");
}

function extFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("text")) return "ass";
  return "png";
}

async function uploadToStorage(
  db: ReturnType<typeof createServiceClient>,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new AppError(`Erro ao subir asset no Storage: ${error.message}`, 500, "STORAGE_ERROR");
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function fetchEpisodeAssets(
  db: ReturnType<typeof createServiceClient>,
  episodeId: string,
): Promise<ExistingAsset[]> {
  const { data, error } = await db
    .from("assets")
    .select("type,url,license,source,author,metadata")
    .eq("episode_id", episodeId);
  if (error) throw new AppError(`Erro ao buscar assets existentes: ${error.message}`, 500, "DB_ERROR");
  return (data ?? []) as ExistingAsset[];
}

async function insertAssetRows(
  db: ReturnType<typeof createServiceClient>,
  rows: AssetRowInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("assets").insert(rows);
  if (error) throw new AppError(`Erro ao registrar assets: ${error.message}`, 500, "DB_ERROR");
}

async function deleteGeneratedAssets(
  db: ReturnType<typeof createServiceClient>,
  episodeId: string,
  types: AssetType[],
): Promise<void> {
  const { error } = await db.from("assets").delete().eq("episode_id", episodeId).in("type", types);
  if (error) throw new AppError(`Erro ao limpar assets parciais: ${error.message}`, 500, "DB_ERROR");
}

function assetFor(
  assets: ExistingAsset[],
  type: AssetType,
  sceneOrder: number,
  orientation?: Orientation,
): ExistingAsset | undefined {
  return assets.find((asset) => {
    if (asset.type !== type) return false;
    if (asset.metadata?.scene_order !== sceneOrder) return false;
    return !orientation || asset.metadata?.orientation === orientation;
  });
}

function assetRef(asset: ExistingAsset): AssetRef {
  return { url: asset.url, license: asset.license, source: asset.source };
}

function audioInfoFromAsset(asset: ExistingAsset, sceneOrder: number): AudioInfo | null {
  const duration = Number(asset.metadata?.duration_seconds ?? 0);
  const engine = asset.metadata?.tts_engine;
  if (duration <= 0 || (engine !== "gemini" && engine !== "edge" && engine !== "piper")) return null;
  const rawBoundaries = asset.metadata?.word_boundaries;
  const word_boundaries = Array.isArray(rawBoundaries) ? rawBoundaries as TtsWordBoundary[] : null;
  return { scene_order: sceneOrder, url: asset.url, tts_engine: engine, duration_seconds: duration, word_boundaries };
}

function allScenesHaveImages(scenes: Scene[], assets: ExistingAsset[]): boolean {
  return scenes.every((scene) => ORIENTATIONS.every((orientation) => assetFor(assets, "image", scene.order, orientation)));
}

function existingAudioByScene(scenes: Scene[], assets: ExistingAsset[]): Map<number, AudioInfo> {
  const map = new Map<number, AudioInfo>();
  for (const scene of scenes) {
    const asset = assetFor(assets, "audio", scene.order);
    if (!asset) continue;
    const info = audioInfoFromAsset(asset, scene.order);
    if (info) map.set(scene.order, info);
  }
  return map;
}

function allScenesHaveSubtitles(scenes: Scene[], assets: ExistingAsset[]): boolean {
  return scenes.every((scene) => ORIENTATIONS.every((orientation) => assetFor(assets, "subtitle", scene.order, orientation)));
}

async function stageImages(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episode: EpisodeRow;
  script: z.infer<typeof scriptJsonSchema>;
  cfg: AssetsConfig;
  spokesmodelCfg: SpokesmodelConfig;
  bucket: string;
  assets: ExistingAsset[];
}): Promise<{ script: z.infer<typeof scriptJsonSchema>; counts: Record<string, number> }> {
  const { db, logger, episode, script, cfg, spokesmodelCfg, bucket, assets } = args;
  const counts = { affiliate: 0, generated: 0, pexels: 0, skipped: 0, presenter: 0 };

  if (allScenesHaveImages(script.scenes, assets)) {
    const scenes = script.scenes.map((scene) => ({
      ...scene,
      asset_landscape: assetRef(assetFor(assets, "image", scene.order, "landscape")!),
      asset_portrait: assetRef(assetFor(assets, "image", scene.order, "portrait")!),
    }));
    await logger.event({ episode_id: episode.id, event_type: "images_generated", metadata: { skipped: true } });
    return { script: scriptJsonSchema.parse({ ...script, scenes }), counts: { ...counts, skipped: script.scenes.length } };
  }

  const imageModel = cfg.image_model ?? "gemini-2.5-flash-image";
  const plan = planAssetSources({
    scenes: script.scenes.map((s) => ({ order: s.order, role: s.role })),
    hasAffiliateImage: Boolean(episode.product_image_url && episode.product_compliance?.image_rights_confirmed),
    imageGenerationEnabled: false, // ADR-015: image API has no free tier
    imageQuotaRemaining: await getGeminiBudgetRemaining(db, "image"),
  });
  const planByOrder = new Map(plan.map((p) => [p.order, p.source]));
  const rows: AssetRowInsert[] = [];
  let affiliateUrl: string | null = null;

  const resolvedScenes: Scene[] = [];
  for (const scene of [...script.scenes].sort((a, b) => a.order - b.order)) {
    const existingLandscape = assetFor(assets, "image", scene.order, "landscape");
    const existingPortrait = assetFor(assets, "image", scene.order, "portrait");
    if (existingLandscape && existingPortrait) {
      counts.skipped += 1;
      resolvedScenes.push({ ...scene, asset_landscape: assetRef(existingLandscape), asset_portrait: assetRef(existingPortrait) });
      continue;
    }

    // ADR-031: personagem fixo via pool curado de fotos Pexels — sem custo, sem chamada Gemini.
    const presenterPhoto = scene.presenter ? pickPresenterPhoto(spokesmodelCfg, scene.order) : null;
    if (presenterPhoto) {
      for (const orientation of ORIENTATIONS) {
        if (!assetFor(assets, "image", scene.order, orientation)) {
          rows.push({
            episode_id: episode.id,
            type: "image",
            url: orientation === "landscape" ? presenterPhoto.landscape_url : presenterPhoto.portrait_url,
            license: "pexels",
            source: "pexels",
            author: presenterPhoto.author,
            metadata: { scene_order: scene.order, orientation, role: scene.role, source_plan: "spokesmodel", presenter: true, pexels_url: presenterPhoto.pexels_url },
          });
        }
      }
      resolvedScenes.push({
        ...scene,
        asset_landscape: { url: presenterPhoto.landscape_url, license: "pexels", source: "pexels" },
        asset_portrait: { url: presenterPhoto.portrait_url, license: "pexels", source: "pexels" },
      });
      counts.presenter += 1;
      continue;
    }

    let source = planByOrder.get(scene.order)!;
    if (source === "affiliate" && !affiliateUrl) {
      try {
        const img = await downloadImage(episode.product_image_url!, cfg.affiliate_image_max_bytes ?? 5_242_880, cfg.affiliate_image_hosts ?? []);
        affiliateUrl = await uploadToStorage(db, bucket, `episodes/${episode.id}/images/affiliate.${extFromMime(img.mimeType)}`, img.bytes, img.mimeType);
      } catch (err) {
        logger.info("Imagem do produto indisponível; usando stock", { scene: scene.order });
        source = "pexels";
      }
    }
    let landscape: AssetRef;
    let portrait: AssetRef;

    if (source === "affiliate") {
      const reusable = existingLandscape?.url ?? existingPortrait?.url ?? affiliateUrl;
      const url = reusable ?? affiliateUrl!;
      for (const orientation of ORIENTATIONS) {
        if (!assetFor(assets, "image", scene.order, orientation)) {
          rows.push({
            episode_id: episode.id,
            type: "image",
            url,
            license: "own",
            source: "affiliate",
            author: null,
            metadata: { scene_order: scene.order, orientation, role: scene.role, source_plan: source },
          });
        }
      }
      landscape = { url, license: "own", source: "affiliate" };
      portrait = { url, license: "own", source: "affiliate" };
      counts.affiliate += 1;
    } else if (source === "generated") {
      const reusable = existingLandscape?.url ?? existingPortrait?.url;
      let url = reusable;
      if (!url) {
        const img = await geminiGenerateImage({ model: imageModel, prompt: scene.visual.description,
          beforeRequest: () => assertGeminiBudget(db, logger, episode.id, "image", imageModel) });
        await recordGeminiCall(logger, episode.id, "image", imageModel, img.usage);
        url = await uploadToStorage(
          db,
          bucket,
          `episodes/${episode.id}/images/scene_${padSceneOrder(scene.order)}.${extFromMime(img.mimeType)}`,
          img.bytes,
          img.mimeType,
        );
      }
      for (const orientation of ORIENTATIONS) {
        if (!assetFor(assets, "image", scene.order, orientation)) {
          rows.push({
            episode_id: episode.id,
            type: "image",
            url,
            license: "generated",
            source: "gemini",
            author: null,
            metadata: { scene_order: scene.order, orientation, role: scene.role, source_plan: source },
          });
        }
      }
      landscape = { url, license: "generated", source: "gemini" };
      portrait = { url, license: "generated", source: "gemini" };
      counts.generated += 1;
    } else {
      const photo = (await searchPexelsPhoto(scene.visual.search_query)) ??
        (await searchPexelsPhoto(cfg.pexels_fallback_query ?? "technology gadget"));
      if (!photo) throw new AppError(`Pexels sem resultados para cena ${scene.order}`, 502, "ASSETS_IMAGE_FAILED");
      const pexelsByOrientation = { landscape: photo.landscape_url, portrait: photo.portrait_url };
      for (const orientation of ORIENTATIONS) {
        if (!assetFor(assets, "image", scene.order, orientation)) {
          rows.push({
            episode_id: episode.id,
            type: "image",
            url: pexelsByOrientation[orientation],
            license: "pexels",
            source: "pexels",
            author: photo.author,
            metadata: { scene_order: scene.order, orientation, role: scene.role, pexels_url: photo.pexels_url, source_plan: source },
          });
        }
      }
      landscape = { url: photo.landscape_url, license: "pexels", source: "pexels" };
      portrait = { url: photo.portrait_url, license: "pexels", source: "pexels" };
      counts.pexels += 1;
    }

    await insertAssetRows(db, rows.splice(0));
    resolvedScenes.push({ ...scene, asset_landscape: landscape, asset_portrait: portrait });
    throw new AppError("Checkpoint de imagem salvo", 202, "CHECKPOINT_PENDING");
  }

  await insertAssetRows(db, rows);
  const resolvedScript = scriptJsonSchema.parse({ ...script, scenes: resolvedScenes });
  const { error } = await db.from("episodes").update({ script_json: resolvedScript }).eq("id", episode.id);
  if (error) throw new AppError(`Erro ao salvar checkpoint de imagens: ${error.message}`, 500, "DB_ERROR");
  await logger.event({ episode_id: episode.id, event_type: "images_generated", model_used: counts.generated ? imageModel : undefined, cost_estimate: 0, metadata: counts });
  return { script: resolvedScript, counts };
}

async function synthesizeWithBudget(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episodeId: string;
  engine: TtsEngine;
  text: string;
  cfg: TtsConfig;
}): Promise<TtsResult> {
  const result = await synthesizeTts(args.engine, args.text, args.cfg, () =>
    assertGeminiBudget(args.db, args.logger, args.episodeId, "tts", args.cfg.gemini_tts_model ?? "gemini-2.5-flash-preview-tts"));
  if (args.engine === "gemini" && result.usage) {
    await recordGeminiCall(args.logger, args.episodeId, "tts", args.cfg.gemini_tts_model ?? "gemini-2.5-flash-preview-tts", result.usage);
  }
  return result;
}

async function selectTtsEngine(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episode: EpisodeRow;
  cfg: TtsConfig;
}): Promise<TtsEngine> {
  const chain = normalizeTtsChain(args.cfg.chain);
  if (!args.cfg.preflight_enabled) {
    const engine = chain[0]!;
    await args.db.from("episodes").update({ tts_engine: engine }).eq("id", args.episode.id);
    await args.logger.event({ episode_id: args.episode.id, event_type: "tts_engine_selected", metadata: { engine, preflight: false } });
    return engine;
  }

  for (const engine of chain) {
    try {
      await synthesizeWithBudget({
        db: args.db,
        logger: args.logger,
        episodeId: args.episode.id,
        engine,
        text: args.cfg.preflight_text ?? "Teste de voz.",
        cfg: args.cfg,
      });
      await args.db.from("episodes").update({ tts_engine: engine }).eq("id", args.episode.id);
      await args.logger.event({ episode_id: args.episode.id, event_type: "tts_engine_selected", metadata: { engine, preflight: true } });
      return engine;
    } catch (err) {
      if (err instanceof AppError && err.code === "ASSETS_RUNNER_REQUIRED") {
        await args.db.from("episodes").update({ tts_engine: engine }).eq("id", args.episode.id);
        throw err;
      }
      if (err instanceof AppError && err.code === "DB_ERROR") throw err;
      await args.logger.event({
        episode_id: args.episode.id,
        event_type: "tts_fallback_triggered",
        error_message: err instanceof Error ? err.message : String(err),
        metadata: { failed_engine: engine, stage: "preflight" },
      });
    }
  }
  throw new AppError("Nenhuma engine TTS disponível no pre-flight", 502, "TTS_PREFLIGHT_FAILED");
}

async function generateAudioSet(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episode: EpisodeRow;
  scenes: Scene[];
  cfg: TtsConfig;
  bucket: string;
  engine: TtsEngine;
  existing: Map<number, AudioInfo>;
}): Promise<Map<number, AudioInfo>> {
  const infos = new Map(args.existing);
  const rows: AssetRowInsert[] = [];
  const deviations: Array<{ scene: number; target: number; actual: number }> = [];
  const threshold = args.cfg.duration_deviation_warn_percent ?? 50;

  for (const scene of [...args.scenes].sort((a, b) => a.order - b.order)) {
    if (infos.has(scene.order)) continue;
    const tts = await synthesizeWithBudget({
      db: args.db,
      logger: args.logger,
      episodeId: args.episode.id,
      engine: args.engine,
      text: scene.narration_text,
      cfg: args.cfg,
    });
    const path = `episodes/${args.episode.id}/audio/scene_${padSceneOrder(scene.order)}.${tts.extension}`;
    const url = await uploadToStorage(args.db, args.bucket, path, tts.bytes, tts.mimeType);
    const info: AudioInfo = {
      scene_order: scene.order,
      url,
      tts_engine: args.engine,
      duration_seconds: tts.duration_seconds,
      word_boundaries: tts.word_boundaries,
    };
    infos.set(scene.order, info);
    if (exceedsDurationDeviation(scene.duration_seconds, tts.duration_seconds, threshold)) {
      deviations.push({ scene: scene.order, target: scene.duration_seconds, actual: tts.duration_seconds });
    }
    rows.push({
      episode_id: args.episode.id,
      type: "audio",
      url,
      license: "own",
      source: sourceForTtsEngine(args.engine),
      author: null,
      metadata: { ...info, deviation_warn: deviations.some((d) => d.scene === scene.order) },
    });
    await insertAssetRows(args.db, [rows[rows.length - 1]!]);
    throw new AppError("Checkpoint de áudio salvo", 202, "CHECKPOINT_PENDING");
  }

  await args.logger.event({
    episode_id: args.episode.id,
    event_type: "tts_generated",
    model_used: args.engine === "gemini" ? args.cfg.gemini_tts_model ?? "gemini-2.5-flash-preview-tts" : undefined,
    cost_estimate: 0,
    metadata: { engine: args.engine, generated: rows.length, skipped: args.scenes.length - rows.length, deviations },
  });
  return infos;
}

async function stageTts(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episode: EpisodeRow;
  scenes: Scene[];
  cfg: TtsConfig;
  bucket: string;
  assets: ExistingAsset[];
}): Promise<Map<number, AudioInfo>> {
  const existing = existingAudioByScene(args.scenes, args.assets);
  const engines = new Set([...existing.values()].map(a => a.tts_engine));
  if (engines.size > 1 || (args.episode.tts_engine && engines.size && !engines.has(args.episode.tts_engine))) {
    await deleteGeneratedAssets(args.db, args.episode.id, ["audio", "subtitle"]);
    existing.clear();
  }
  if (existing.size === args.scenes.length) {
    await args.logger.event({ episode_id: args.episode.id, event_type: "tts_generated", metadata: { skipped: true, count: existing.size } });
    return existing;
  }

  const chain = normalizeTtsChain(args.cfg.chain);
  const firstExisting = existing.values().next().value as AudioInfo | undefined;
  const lockedEngine = args.episode.tts_engine ?? firstExisting?.tts_engine;
  const selected = lockedEngine ?? await selectTtsEngine(args);
  if (!lockedEngine) throw new AppError("Pre-flight salvo", 202, "CHECKPOINT_PENDING");
  if (!args.episode.tts_engine && firstExisting?.tts_engine === selected) {
    await args.db.from("episodes").update({ tts_engine: selected }).eq("id", args.episode.id);
    await args.logger.event({
      episode_id: args.episode.id,
      event_type: "tts_engine_selected",
      metadata: { engine: selected, restored_from_checkpoint: true },
    });
  }
  const startIndex = Math.max(0, chain.indexOf(selected));

  for (let i = startIndex; i < chain.length; i++) {
    const engine = chain[i]!;
    try {
      const keepExisting = engine === selected;
      return await generateAudioSet({ ...args, engine, existing: keepExisting ? existing : new Map() });
    } catch (err) {
      if (err instanceof AppError && err.status === 202) throw err;
      if (err instanceof AppError && ["DB_ERROR", "STORAGE_ERROR"].includes(err.code)) throw err;
      const next = chain[i + 1];
      if (!next) throw err;
      await deleteGeneratedAssets(args.db, args.episode.id, ["audio", "subtitle"]);
      await args.db.from("episodes").update({ tts_engine: next }).eq("id", args.episode.id);
      await args.logger.event({
        episode_id: args.episode.id,
        event_type: "tts_consistency_regeneration",
        error_message: err instanceof Error ? err.message : String(err),
        metadata: { from: engine, to: next },
      });
      await args.logger.event({
        episode_id: args.episode.id,
        event_type: "tts_fallback_triggered",
        error_message: err instanceof Error ? err.message : String(err),
        metadata: { failed_engine: engine, next_engine: next, stage: "scene_generation" },
      });
    }
  }
  throw new AppError("Nenhuma engine TTS concluiu todas as cenas", 502, "TTS_GENERATION_FAILED");
}

async function stageSubtitles(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episode: EpisodeRow;
  scenes: Scene[];
  audio: Map<number, AudioInfo>;
  bucket: string;
  assets: ExistingAsset[];
}): Promise<{ generated: number; skipped: number }> {
  if (allScenesHaveSubtitles(args.scenes, args.assets)) {
    await args.logger.event({ episode_id: args.episode.id, event_type: "subtitles_generated", metadata: { skipped: true } });
    return { generated: 0, skipped: args.scenes.length * ORIENTATIONS.length };
  }

  const rows: AssetRowInsert[] = [];
  for (const scene of [...args.scenes].sort((a, b) => a.order - b.order)) {
    const audio = args.audio.get(scene.order);
    if (!audio) throw new AppError(`Áudio ausente para legenda da cena ${scene.order}`, 500, "SUBTITLE_AUDIO_MISSING");
    const words = resolveWordTimings({
      narration_text: scene.narration_text,
      audio_duration_seconds: audio.duration_seconds,
      word_boundaries: audio.word_boundaries,
    });
    for (const orientation of ORIENTATIONS) {
      if (assetFor(args.assets, "subtitle", scene.order, orientation)) continue;
      const content = buildAssSubtitles([
        {
          words,
          scene_start_seconds: 0,
          highlight_words: scene.highlight_words,
          subtitle_position: orientation === "landscape" ? "bottom_left" : scene.subtitle_position,
        },
      ], orientation === "landscape" ? SUBTITLE_STYLE_LANDSCAPE : SUBTITLE_STYLE_PORTRAIT);
      const path = `episodes/${args.episode.id}/subtitles/scene_${padSceneOrder(scene.order)}_${orientation}.ass`;
      const url = await uploadToStorage(args.db, args.bucket, path, new TextEncoder().encode(content), "text/x-ass");
      rows.push({
        episode_id: args.episode.id,
        type: "subtitle",
        url,
        license: "own",
        source: "system",
        author: null,
        metadata: { scene_order: scene.order, orientation, tts_engine: audio.tts_engine, duration_seconds: audio.duration_seconds },
      });
    }
  }

  await insertAssetRows(args.db, rows);
  await args.logger.event({
    episode_id: args.episode.id,
    event_type: "subtitles_generated",
    metadata: { generated: rows.length, skipped: args.scenes.length * ORIENTATIONS.length - rows.length },
  });
  return { generated: rows.length, skipped: args.scenes.length * ORIENTATIONS.length - rows.length };
}

export async function handleAssets(req: Request): Promise<Response> {
  try { requireServiceRole(req); } catch (err) { return toErrorResponse(err); }
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let release: (() => Promise<void>) | undefined;
  let logger: JobLogger | undefined;
  let episodeForFailure: EpisodeRow | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-assets");
    release = await claimEpisode(db, input.episode_id);

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, script_json, research_data, research_evidence, product_image_url, product_compliance, tts_engine")
      .eq("id", input.episode_id)
      .maybeSingle();
    if (error) throw new AppError(`Erro ao buscar episódio: ${error.message}`, 500, "DB_ERROR");
    if (!episode) throw new AppError("Episódio não encontrado", 404, "NOT_FOUND");
    episodeForFailure = episode as EpisodeRow;
    if (episode.status !== "script") {
      throw new AppError(`Episódio em '${episode.status}' — assets exige status 'script'`, 409, "INVALID_STATE");
    }

    const script = scriptJsonSchema.parse(episode.script_json);
    const quality = await loadScriptQualityChecker(db);
    const research = researchDataSchema.safeParse(episode.research_data);
    if (!research.success) throw new AppError("Pesquisa ausente ou inválida para checagem do roteiro", 422, "SCRIPT_RESEARCH_INVALID");
    if (!researchMatchesEvidence(research.data, episode.research_evidence)) {
      throw new AppError("Pesquisa sem evidência válida ou alterada após grounding", 422, "RESEARCH_EVIDENCE_INVALID");
    }
    const report = quality.check(script, research.data, Boolean(episode.product_compliance?.commercial_content));
    if (!report.passed) {
      await recordScriptQuality(db, episode.id, report, {
        stage: "generate-assets", script_hash: await computeScriptHash(script), policy_hash: quality.policy_hash,
      });
      throw new AppError("Roteiro reprovado antes de gerar assets; consulte qa_failed em job_events", 422, "SCRIPT_QUALITY_FAILED");
    }
    const cfg = await getSystemConfig<AssetsConfig>(db, "assets", {});
    const ttsCfg = await getSystemConfig<TtsConfig>(db, "tts", {});
    const spokesmodelCfg = await getSystemConfig<SpokesmodelConfig>(db, "spokesmodel", {});
    const bucket = cfg.storage_bucket ?? "assets";
    let assets = await fetchEpisodeAssets(db, episode.id);

    const images = await stageImages({ db, logger, episode: episodeForFailure, script, cfg, spokesmodelCfg, bucket, assets });
    assets = await fetchEpisodeAssets(db, episode.id);

    const audio = await stageTts({
      db,
      logger,
      episode: episodeForFailure,
      scenes: images.script.scenes,
      cfg: ttsCfg,
      bucket,
      assets,
    });
    assets = await fetchEpisodeAssets(db, episode.id);

    const subtitles = await stageSubtitles({
      db,
      logger,
      episode: episodeForFailure,
      scenes: images.script.scenes,
      audio,
      bucket,
      assets,
    });

    if (!isRenderReady(images.script)) throw new AppError("Script resolvido não está render-ready", 500, "INVARIANT_VIOLATION");
    const { error: updateError } = await db
      .from("episodes")
      .update({ script_json: images.script, status: "assets" })
      .eq("id", episode.id);
    if (updateError) throw new AppError(`Erro ao marcar assets: ${updateError.message}`, 500, "DB_ERROR");

    await logger.event({
      episode_id: episode.id,
      event_type: "assets_generated",
      cost_estimate: 0,
      metadata: { images: images.counts, audio: audio.size, subtitles },
    });

    logger.info("assets completos", { episode_id: episode.id, images: images.counts, audio: audio.size, subtitles });
    return jsonResponse({ episode_id: episode.id, images: images.counts, audio: audio.size, subtitles }, 200);
  } catch (err) {
    if (err instanceof AppError && err.status === 202) {
      return jsonResponse({ pending: true, code: err.code }, 202);
    }
    logger?.error("falha no generate-assets", err);
    if (logger && episodeForFailure?.status === "script" && !(err instanceof AppError && ["INVALID_STATE", "NOT_FOUND", "QA_CONFIG_INVALID", "DB_ERROR"].includes(err.code))) {
      const reason = err instanceof AppError && err.code === "RESEARCH_EVIDENCE_INVALID"
        ? "research_evidence_invalid"
        : err instanceof AppError && err.code.startsWith("SCRIPT_")
        ? "script_quality_failed"
        : err instanceof AppError && err.code.startsWith("TTS")
        ? "tts_generation_failed"
        : err instanceof AppError && err.code.startsWith("SUBTITLE")
        ? "subtitles_generation_failed"
        : "assets_generation_failed";
      const db = createServiceClient();
      await markEpisodeFailed(db, logger, episodeForFailure.id, reason, err instanceof Error ? err.message : String(err), "script");
    }
    return toErrorResponse(err);
  } finally {
    await release?.();
  }
}
