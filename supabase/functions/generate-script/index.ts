// generate-script — Fase 2 (ADR-008): Gemini Flash + responseSchema, SEM grounding.
// research → script. Repair loop de 1 tentativa; campos de sistema normalizados
// pós-parse (o modelo nunca controla episode_id/hash/disclosure sintética).

import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { assertGeminiBudget, recordGeminiCall } from "../_shared/budget-guard.ts";
import { extractJson, geminiGenerate } from "../_shared/gemini.ts";
import { markEpisodeFailed } from "../_shared/episode-utils.ts";
import { scriptJsonSchema } from "../../../packages/core/src/schemas/script-json.ts";
import { researchDataSchema } from "../../../packages/core/src/schemas/research.ts";
import { computeScriptHash } from "../../../packages/core/src/validators/hash-utils.ts";
import {
  buildRepairPrompt,
  buildScriptPrompt,
  SCRIPT_PROMPT_NAME,
} from "../../../packages/core/src/prompts/script-prompt.ts";

const inputSchema = z.object({ episode_id: z.string().uuid() });

interface GeminiConfig {
  text_model?: string;
  script_temperature?: number;
}

// Subset OpenAPI aceito pelo Gemini: garante JSON parseável com campos obrigatórios.
// Invariantes cross-field (order contíguo, roles, soma 60-600s) ficam no Zod.
const SCENE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    order: { type: "INTEGER" },
    role: { type: "STRING", enum: ["hook", "content", "cta"] },
    duration_seconds: { type: "NUMBER" },
    narration_text: { type: "STRING" },
    transition: { type: "STRING", enum: ["cut", "fade", "zoom"] },
    ken_burns: { type: "STRING", enum: ["in", "out", "pan_left", "pan_right", "static"] },
    visual: {
      type: "OBJECT",
      properties: {
        description: { type: "STRING" },
        search_query: { type: "STRING" },
      },
      required: ["description", "search_query"],
    },
    highlight_words: { type: "ARRAY", items: { type: "STRING" } },
    subtitle_position: { type: "STRING", enum: ["bottom_center", "bottom_left"] },
  },
  required: [
    "id",
    "order",
    "role",
    "duration_seconds",
    "narration_text",
    "transition",
    "ken_burns",
    "visual",
    "highlight_words",
    "subtitle_position",
  ],
};

const SCRIPT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    metadata: {
      type: "OBJECT",
      properties: {
        youtube: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            description: { type: "STRING" },
            tags: { type: "ARRAY", items: { type: "STRING" } },
            category: { type: "STRING" },
          },
          required: ["title", "description", "tags", "category"],
        },
        tiktok: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            description: { type: "STRING" },
            hashtags: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["title", "description", "hashtags"],
        },
      },
      required: ["youtube", "tiktok"],
    },
    narration: {
      type: "OBJECT",
      properties: {
        full_text: { type: "STRING" },
        language: { type: "STRING", enum: ["pt-BR"] },
        estimated_duration_seconds: { type: "NUMBER" },
      },
      required: ["full_text", "language", "estimated_duration_seconds"],
    },
    scenes: { type: "ARRAY", items: SCENE_RESPONSE_SCHEMA },
    sources: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          claim: { type: "STRING" },
          source_url: { type: "STRING" },
        },
        required: ["claim", "source_url"],
      },
    },
    disclosures: {
      type: "OBJECT",
      properties: {
        contains_synthetic_media: { type: "BOOLEAN" },
        commercial_content: { type: "BOOLEAN" },
        commercial_disclosure_text: { type: "STRING", nullable: true },
      },
      required: ["contains_synthetic_media", "commercial_content"],
    },
  },
  required: ["metadata", "narration", "scenes", "sources", "disclosures"],
};

/** Campos de sistema nunca ficam a cargo do modelo (ADR-008). */
function normalizeSystemFields(
  raw: Record<string, unknown>,
  episodeId: string,
  promptVersion: string,
  isCommercial: boolean,
): Record<string, unknown> {
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes.map((s) => ({
      ...(s as Record<string, unknown>),
      asset_landscape: null,
      asset_portrait: null,
    }))
    : raw.scenes;
  const disclosures = {
    ...(raw.disclosures as Record<string, unknown> ?? {}),
    contains_synthetic_media: true,
    commercial_content: isCommercial,
    ...(isCommercial ? {} : { commercial_disclosure_text: null }),
  };
  return {
    ...raw,
    episode_id: episodeId,
    prompt_version: promptVersion,
    music: null,
    scenes,
    disclosures,
  };
}

async function getActivePromptVersion(
  db: ReturnType<typeof createServiceClient>,
): Promise<string> {
  const { data } = await db
    .from("prompt_versions")
    .select("version")
    .eq("name", SCRIPT_PROMPT_NAME)
    .eq("is_active", true)
    .maybeSingle();
  return data?.version ?? "1.0.0";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-script");

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, briefing, research_data, product_compliance")
      .eq("id", input.episode_id)
      .maybeSingle();
    if (error) throw new AppError(`Erro ao buscar episódio: ${error.message}`, 500, "DB_ERROR");
    if (!episode) throw new AppError("Episódio não encontrado", 404, "NOT_FOUND");
    if (episode.status !== "research") {
      throw new AppError(
        `Episódio em '${episode.status}' — script exige status 'research'`,
        409,
        "INVALID_STATE",
      );
    }

    const research = researchDataSchema.safeParse(episode.research_data);
    if (!research.success) {
      throw new AppError("Episódio sem research_data válido", 422, "MISSING_RESEARCH");
    }
    const briefingText = (episode.briefing as { text?: string } | null)?.text ?? "";
    const isCommercial = Boolean(
      (episode.product_compliance as { commercial_content?: boolean } | null)?.commercial_content,
    );

    const gemini = await getSystemConfig<GeminiConfig>(db, "gemini", {});
    const model = gemini.text_model ?? "gemini-2.5-flash";
    const promptVersion = await getActivePromptVersion(db);

    const basePrompt = buildScriptPrompt({
      briefing: briefingText,
      researchData: research.data,
      isCommercial,
    });

    // Tentativa 1 + repair loop (máx. 1 retry com os erros do Zod no prompt)
    let scriptJson: z.infer<typeof scriptJsonSchema> | undefined;
    let lastErrors: string[] = [];
    let lastInvalidJson = "";
    let attempts = 0;

    for (const attempt of [1, 2] as const) {
      attempts = attempt;
      await assertGeminiBudget(db, logger, episode.id, "text");
      const prompt = attempt === 1
        ? basePrompt
        : buildRepairPrompt(lastInvalidJson, lastErrors);

      const result = await geminiGenerate({
        model,
        prompt,
        responseSchema: SCRIPT_RESPONSE_SCHEMA,
        temperature: gemini.script_temperature ?? 0.7,
      });
      await recordGeminiCall(logger, episode.id, "text", model, result.usage);

      const raw = extractJson(result.text) as Record<string, unknown>;
      const normalized = normalizeSystemFields(raw, episode.id, promptVersion, isCommercial);
      const parsed = scriptJsonSchema.safeParse(normalized);

      if (parsed.success) {
        scriptJson = parsed.data;
        break;
      }
      lastErrors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      lastInvalidJson = JSON.stringify(normalized).slice(0, 8000);
      logger.info("validação Zod falhou", { attempt, errors: lastErrors });
    }

    if (!scriptJson) {
      await markEpisodeFailed(
        db,
        logger,
        episode.id,
        "json_validation_failed",
        lastErrors.join("; ").slice(0, 1000),
      );
      throw new AppError(
        "script_json inválido após repair loop — episódio marcado como failed",
        502,
        "JSON_VALIDATION_FAILED",
      );
    }

    const scriptHash = await computeScriptHash(scriptJson);
    const { error: updateError } = await db
      .from("episodes")
      .update({
        script_json: scriptJson,
        script_hash: scriptHash,
        prompt_version: promptVersion,
        metadata: scriptJson.metadata,
        status: "script",
      })
      .eq("id", episode.id);

    if (updateError) {
      // 23505 = colisão de script_hash UNIQUE → roteiro duplicado (idempotência, ADR-005)
      if (updateError.code === "23505") {
        await markEpisodeFailed(db, logger, episode.id, "duplicate_script", `script_hash já existe: ${scriptHash}`);
        throw new AppError("Roteiro duplicado detectado (script_hash colidiu)", 409, "DUPLICATE_SCRIPT");
      }
      throw new AppError(`Erro ao salvar script: ${updateError.message}`, 500, "DB_ERROR");
    }

    await logger.event({
      episode_id: episode.id,
      event_type: "script_generated",
      model_used: model,
      prompt_version: promptVersion,
      cost_estimate: 0,
      metadata: { attempts, scenes: scriptJson.scenes.length, script_hash: scriptHash },
    });

    logger.info("script gerado", { episode_id: episode.id, attempts, script_hash: scriptHash });
    return jsonResponse(
      { episode_id: episode.id, script_hash: scriptHash, attempts, scenes: scriptJson.scenes.length },
      200,
    );
  } catch (err) {
    logger?.error("falha no generate-script", err);
    return toErrorResponse(err);
  }
});
