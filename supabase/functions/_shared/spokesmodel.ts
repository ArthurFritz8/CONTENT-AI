// ADR-030: personagem/apresentador fixo, opt-in e orçado separadamente do
// caminho de imagem genérico (vetado pelo ADR-015). A imagem de referência é
// gerada UMA VEZ e reaproveitada para sempre entre todos os episódios; cada
// cena com presenter=true gera uma nova pose condicionada a essa referência
// (consistência de personagem nativa do Nano Banana).

import { AppError } from "./error-handler.ts";
import { assertGeminiBudget, recordGeminiCall } from "./budget-guard.ts";
import { geminiGenerateImage, type GeminiImageResult } from "./gemini.ts";
import type { createServiceClient } from "./supabase-client.ts";
import type { JobLogger } from "./logger.ts";

export interface SpokesmodelConfig {
  enabled?: boolean;
  character_description?: string | null;
  reference_image_url?: string | null;
  max_scenes_per_episode?: number;
}

const REFERENCE_STORAGE_PATH = "branding/spokesmodel/reference.png";

async function downloadReferenceImage(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new AppError(`Falha ao baixar imagem de referência do personagem (${res.status})`, 502, "SPOKESMODEL_REFERENCE_FETCH_FAILED");
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: contentType };
}

/** Retorna a imagem-âncora do personagem, gerando-a uma única vez se ainda não existir. */
export async function ensureSpokesmodelReference(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episodeId: string;
  bucket: string;
  cfg: SpokesmodelConfig;
  imageModel: string;
}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const { db, logger, episodeId, bucket, cfg, imageModel } = args;
  if (!cfg.enabled || !cfg.character_description) return null;

  if (cfg.reference_image_url) {
    try {
      return await downloadReferenceImage(cfg.reference_image_url);
    } catch (err) {
      logger.info("Referência do personagem indisponível; será regenerada", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const img = await geminiGenerateImage({
    model: imageModel,
    prompt: `Retrato de corpo inteiro, estúdio, fundo neutro, iluminação profissional, sorriso natural, roupa casual-profissional. ${cfg.character_description}`,
    beforeRequest: () => assertGeminiBudget(db, logger, episodeId, "spokesmodel", imageModel),
  });
  await recordGeminiCall(db, logger, episodeId, "spokesmodel", imageModel, img.usage);

  const { error: uploadError } = await db.storage
    .from(bucket)
    .upload(REFERENCE_STORAGE_PATH, img.bytes, { contentType: img.mimeType, upsert: true });
  if (uploadError) throw new AppError(`Erro ao salvar referência do personagem: ${uploadError.message}`, 500, "STORAGE_ERROR");

  const url = db.storage.from(bucket).getPublicUrl(REFERENCE_STORAGE_PATH).data.publicUrl;
  const { error: cfgError } = await db
    .from("system_config")
    .update({ value: { ...cfg, reference_image_url: url } })
    .eq("key", "spokesmodel");
  if (cfgError) throw new AppError(`Erro ao persistir referência do personagem: ${cfgError.message}`, 500, "DB_ERROR");

  return { bytes: img.bytes, mimeType: img.mimeType };
}

/** Gera a pose da cena mantendo o mesmo personagem da imagem de referência. */
export async function generatePresenterSceneImage(args: {
  db: ReturnType<typeof createServiceClient>;
  logger: JobLogger;
  episodeId: string;
  imageModel: string;
  sceneDescription: string;
  characterDescription: string;
  reference: { bytes: Uint8Array; mimeType: string };
}): Promise<GeminiImageResult> {
  const { db, logger, episodeId, imageModel, sceneDescription, characterDescription, reference } = args;
  const img = await geminiGenerateImage({
    model: imageModel,
    prompt: `Mantenha exatamente o mesmo personagem da imagem de referência (mesmo rosto, cabelo, tom de pele — consistência estrita, sem trocar de pessoa). ${characterDescription}. Nova cena, mesma pessoa: ${sceneDescription}`,
    referenceImages: [reference],
    beforeRequest: () => assertGeminiBudget(db, logger, episodeId, "spokesmodel", imageModel),
  });
  await recordGeminiCall(db, logger, episodeId, "spokesmodel", imageModel, img.usage);
  return img;
}
