// generate-assets — script → assets (ADR-009): cadeia de fallback por role.
// hook: afiliado → Nano Banana → Pexels | content: Nano Banana → Pexels | cta: Pexels.
// A decisão é do planner puro do core; aqui só se executa o plano.

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
import { searchPexelsPhoto } from "../_shared/pexels.ts";
import { markEpisodeFailed } from "../_shared/episode-utils.ts";
import {
  type AssetRef,
  isRenderReady,
  type Scene,
  scriptJsonSchema,
} from "../../../packages/core/src/schemas/script-json.ts";
import { planAssetSources } from "../../../packages/core/src/planners/asset-plan.ts";

const inputSchema = z.object({ episode_id: z.string().uuid() });

interface AssetsConfig {
  image_generation_enabled?: boolean;
  image_model?: string;
  storage_bucket?: string;
  pexels_fallback_query?: string;
  affiliate_image_max_bytes?: number;
}

interface AssetRowInsert {
  episode_id: string;
  type: "image";
  url: string;
  license: AssetRef["license"];
  source: AssetRef["source"];
  author: string | null;
}

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

async function uploadToStorage(
  db: ReturnType<typeof createServiceClient>,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new AppError(`Erro ao subir asset no Storage: ${error.message}`, 500, "STORAGE_ERROR");
  }
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function downloadAffiliateImage(
  url: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new AppError(`Imagem do afiliado inacessível (${res.status})`, 502, "AFFILIATE_IMAGE_FAILED");
  }
  const mimeType = res.headers.get("content-type") ?? "";
  if (!mimeType.startsWith("image/")) {
    throw new AppError(`product_image_url não é imagem (${mimeType})`, 422, "AFFILIATE_IMAGE_INVALID");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new AppError(`Imagem do afiliado excede ${maxBytes} bytes`, 422, "AFFILIATE_IMAGE_TOO_LARGE");
  }
  return { bytes, mimeType };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-assets");

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, script_json, product_image_url")
      .eq("id", input.episode_id)
      .maybeSingle();
    if (error) throw new AppError(`Erro ao buscar episódio: ${error.message}`, 500, "DB_ERROR");
    if (!episode) throw new AppError("Episódio não encontrado", 404, "NOT_FOUND");
    if (episode.status !== "script") {
      throw new AppError(
        `Episódio em '${episode.status}' — assets exige status 'script'`,
        409,
        "INVALID_STATE",
      );
    }

    const script = scriptJsonSchema.parse(episode.script_json);
    const cfg = await getSystemConfig<AssetsConfig>(db, "assets", {});
    const bucket = cfg.storage_bucket ?? "assets";
    const imageModel = cfg.image_model ?? "gemini-2.5-flash-image";

    const plan = planAssetSources({
      scenes: script.scenes.map((s) => ({ order: s.order, role: s.role })),
      hasAffiliateImage: Boolean(episode.product_image_url),
      imageGenerationEnabled: cfg.image_generation_enabled ?? false,
      imageQuotaRemaining: await getGeminiBudgetRemaining(db, "image"),
    });
    const planByOrder = new Map(plan.map((p) => [p.order, p.source]));

    const assetRows: AssetRowInsert[] = [];
    const counts = { affiliate: 0, generated: 0, pexels: 0 };
    // imagem do afiliado é única — baixa/reaproveita para todas as cenas que a usarem
    let affiliateUrl: string | null = null;

    const resolvedScenes: Scene[] = [];
    for (const scene of [...script.scenes].sort((a, b) => a.order - b.order)) {
      const source = planByOrder.get(scene.order)!;
      let landscape: AssetRef;
      let portrait: AssetRef;

      if (source === "affiliate") {
        if (!affiliateUrl) {
          const img = await downloadAffiliateImage(
            episode.product_image_url!,
            cfg.affiliate_image_max_bytes ?? 5_242_880,
          );
          affiliateUrl = await uploadToStorage(
            db,
            bucket,
            `episodes/${episode.id}/affiliate.${extFromMime(img.mimeType)}`,
            img.bytes,
            img.mimeType,
          );
          assetRows.push({
            episode_id: episode.id,
            type: "image",
            url: affiliateUrl,
            license: "own",
            source: "affiliate",
            author: null,
          });
        }
        // imagem única: renderer faz cover-crop por orientação
        landscape = { url: affiliateUrl, license: "own", source: "affiliate" };
        portrait = { url: affiliateUrl, license: "own", source: "affiliate" };
        counts.affiliate += 1;
      } else if (source === "generated") {
        await assertGeminiBudget(db, logger, episode.id, "image");
        const img = await geminiGenerateImage({
          model: imageModel,
          prompt: scene.visual.description,
        });
        await recordGeminiCall(logger, episode.id, "image", imageModel, img.usage);
        const url = await uploadToStorage(
          db,
          bucket,
          `episodes/${episode.id}/scene_${scene.order}.${extFromMime(img.mimeType)}`,
          img.bytes,
          img.mimeType,
        );
        assetRows.push({
          episode_id: episode.id,
          type: "image",
          url,
          license: "generated",
          source: "gemini",
          author: null,
        });
        landscape = { url, license: "generated", source: "gemini" };
        portrait = { url, license: "generated", source: "gemini" };
        counts.generated += 1;
      } else {
        const photo = (await searchPexelsPhoto(scene.visual.search_query)) ??
          (await searchPexelsPhoto(cfg.pexels_fallback_query ?? "technology gadget"));
        if (!photo) {
          await markEpisodeFailed(
            db,
            logger,
            episode.id,
            "assets_generation_failed",
            `Pexels sem resultados para '${scene.visual.search_query}' e fallback`,
          );
          throw new AppError("Pexels sem resultados — episódio marcado como failed", 502, "ASSETS_GENERATION_FAILED");
        }
        for (const url of [photo.landscape_url, photo.portrait_url]) {
          assetRows.push({
            episode_id: episode.id,
            type: "image",
            url,
            license: "pexels",
            source: "pexels",
            author: photo.author,
          });
        }
        landscape = { url: photo.landscape_url, license: "pexels", source: "pexels" };
        portrait = { url: photo.portrait_url, license: "pexels", source: "pexels" };
        counts.pexels += 1;
      }

      resolvedScenes.push({ ...scene, asset_landscape: landscape, asset_portrait: portrait });
    }

    const resolvedScript = scriptJsonSchema.parse({ ...script, scenes: resolvedScenes });
    if (!isRenderReady(resolvedScript)) {
      throw new AppError("Script resolvido não está render-ready", 500, "INVARIANT_VIOLATION");
    }

    const { error: assetsError } = await db.from("assets").insert(assetRows);
    if (assetsError) {
      throw new AppError(`Erro ao registrar assets: ${assetsError.message}`, 500, "DB_ERROR");
    }

    const { error: updateError } = await db
      .from("episodes")
      .update({ script_json: resolvedScript, status: "assets" })
      .eq("id", episode.id);
    if (updateError) {
      throw new AppError(`Erro ao salvar assets no episódio: ${updateError.message}`, 500, "DB_ERROR");
    }

    await logger.event({
      episode_id: episode.id,
      event_type: "assets_generated",
      model_used: counts.generated > 0 ? imageModel : undefined,
      cost_estimate: 0,
      metadata: { ...counts, total_scenes: resolvedScenes.length },
    });

    logger.info("assets resolvidos", { episode_id: episode.id, ...counts });
    return jsonResponse({ episode_id: episode.id, ...counts }, 200);
  } catch (err) {
    logger?.error("falha no generate-assets", err);
    return toErrorResponse(err);
  }
});
