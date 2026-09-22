import { claimEpisode } from "../_shared/episode-lease.ts";
import { applyGrowthStrategy, growthStrategySchema, growthBriefing } from "../../../packages/core/src/publish/growth-strategy.ts";
import { requireServiceRole } from "../_shared/auth.ts";
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
import { researchMatchesEvidence } from "../../../packages/core/src/validators/research-evidence.ts";
import { computeScriptHash } from "../../../packages/core/src/validators/hash-utils.ts";
import type { ScriptQualityReport } from "../../../packages/core/src/validators/script-quality.ts";
import { loadScriptQualityChecker, recordScriptQuality } from "../_shared/script-quality.ts";
import {
  affiliateLinksFromCompliance,
  applyAffiliateMetadata,
  type AffiliateLinks,
} from "../../../packages/core/src/publish/affiliate-metadata.ts";
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

interface SpokesmodelConfig {
  enabled?: boolean;
  character_description?: string;
  max_scenes_per_episode?: number;
}

/** ADR-030: presenter é opt-in e limitado mesmo se o modelo ignorar a instrução do prompt. */
function enforcePresenterCap(
  scenes: Array<Record<string, unknown>>,
  cfg: SpokesmodelConfig,
): Array<Record<string, unknown>> {
  if (!cfg.enabled) return scenes.map((s) => ({ ...s, presenter: false }));
  const cap = Math.max(0, cfg.max_scenes_per_episode ?? 1);
  let used = 0;
  return scenes.map((s) => {
    if (s.presenter === true && used < cap) {
      used += 1;
      return s;
    }
    return { ...s, presenter: false };
  });
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
    presenter: { type: "BOOLEAN" },
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
    "presenter",
    "subtitle_position",
  ],
};

const SCRIPT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    editorial_style: { type: "STRING" },
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
  required: ["metadata", "narration", "scenes", "sources", "disclosures", "editorial_style"],
};

/** Campos de sistema nunca ficam a cargo do modelo (ADR-008). */
function normalizeSystemFields(
  raw: Record<string, unknown>,
  episodeId: string,
  promptVersion: string,
  isCommercial: boolean,
  affiliateLinks: AffiliateLinks,
  spokesmodel: SpokesmodelConfig,
): Record<string, unknown> {
  const withoutAssets = Array.isArray(raw.scenes)
    ? raw.scenes.map((s) => ({
      ...(s as Record<string, unknown>),
      asset_landscape: null,
      asset_portrait: null,
    }))
    : raw.scenes;
  const scenes = Array.isArray(withoutAssets) ? enforcePresenterCap(withoutAssets, spokesmodel) : withoutAssets;
  const disclosures = {
    ...(raw.disclosures as Record<string, unknown> ?? {}),
    contains_synthetic_media: true,
    commercial_content: isCommercial,
    ...(isCommercial ? {} : { commercial_disclosure_text: null }),
  };
  const withAffiliate = applyAffiliateMetadata(
    { ...raw, disclosures },
    affiliateLinks,
    isCommercial,
  ) as Record<string, unknown>;
  return {
    ...withAffiliate,
    episode_id: episodeId,
    prompt_version: promptVersion,
    music: null,
    scenes,
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

export async function handleScript(req: Request): Promise<Response> {
  try { requireServiceRole(req); } catch (err) { return toErrorResponse(err); }
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let release: (() => Promise<void>) | undefined;
  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-script");
    release = await claimEpisode(db, input.episode_id);

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, briefing, research_data, research_evidence, product_compliance")
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
    if (!researchMatchesEvidence(research.data, episode.research_evidence)) {
      await markEpisodeFailed(db, logger, episode.id, "research_evidence_invalid",
        "Pesquisa sem evidência válida ou alterada após grounding", "research");
      throw new AppError("Pesquisa sem evidência válida ou alterada após grounding", 422, "RESEARCH_EVIDENCE_INVALID");
    }
    const briefingText = (episode.briefing as { text?: string } | null)?.text ?? "";
    const affiliateLinks = affiliateLinksFromCompliance(
      episode.product_compliance,
    );
    const growthRaw = await getSystemConfig<unknown>(db, "growth_strategy", null);
    const growth = growthRaw === null ? null : growthStrategySchema.parse(growthRaw);
    const isCommercial = growth ? Boolean(affiliateLinks.youtube) : Object.keys(affiliateLinks).length > 0 || Boolean(
      (episode.product_compliance as { commercial_content?: boolean } | null)
        ?.commercial_content,
    );

    const gemini = await getSystemConfig<GeminiConfig>(db, "gemini", {});
    const spokesmodel = await getSystemConfig<SpokesmodelConfig>(db, "spokesmodel", {});
    const configuredModel = gemini.text_model ?? "gemini-3.6-flash";
    const modelCandidates = [...new Set([
      configuredModel,
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
    ])];
    const promptVersion = await getActivePromptVersion(db);
    // Fail closed before spending quota if editorial policy is missing or invalid.
    const quality = await loadScriptQualityChecker(db);

    const basePrompt = buildScriptPrompt({
      briefing: growth ? `${briefingText}\n${growthBriefing(growth)}` : briefingText,
      platformGrowth: Boolean(growth),
      researchData: research.data,
      isCommercial,
      commercialPlatforms: Object.keys(affiliateLinks) as Array<
        keyof AffiliateLinks
      >,
      spokesmodel: spokesmodel.enabled && spokesmodel.character_description
        ? { characterDescription: spokesmodel.character_description, maxScenesPerEpisode: Math.max(0, spokesmodel.max_scenes_per_episode ?? 1) }
        : undefined,
    });

    // Tentativa 1 + repair loop (máx. 1 retry com os erros do Zod no prompt)
    let scriptJson: z.infer<typeof scriptJsonSchema> | undefined;
    let qualityReport: ScriptQualityReport | undefined;
    let lastErrors: string[] = [];
    let lastInvalidJson = "";
    let attempts = 0;
    let usedModel = configuredModel;

    for (const attempt of [1, 2] as const) {
      attempts = attempt;
      qualityReport = undefined;
      const prompt = attempt === 1
        ? basePrompt
        : `${basePrompt}\n\n${buildRepairPrompt(lastInvalidJson, lastErrors)}`;

      let result: Awaited<ReturnType<typeof geminiGenerate>> | undefined;
      let model = configuredModel;
      let lastModelError: unknown;
      for (const candidate of modelCandidates) {
        try {
          result = await geminiGenerate({
            beforeRequest: () => assertGeminiBudget(db, logger!, episode.id, "text", candidate),
            model: candidate,
            prompt,
            responseSchema: SCRIPT_RESPONSE_SCHEMA,
            temperature: gemini.script_temperature ?? 0.7,
          });
          model = candidate;
          usedModel = candidate;
          break;
        } catch (err) {
          lastModelError = err;
          if (!(err instanceof AppError) || err.status !== 502) throw err;
          logger.info("modelo de roteiro indisponível; tentando fallback", { model: candidate, attempt });
        }
      }
      if (!result) throw lastModelError ?? new AppError("Nenhum modelo Gemini de roteiro respondeu", 502, "GEMINI_CALL_FAILED");
      await recordGeminiCall(logger, episode.id, "text", model, result.usage);

      let normalized: Record<string, unknown>;
      try {
        const raw = extractJson(result.text);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Roteiro deve ser um objeto JSON");
        normalized = normalizeSystemFields(
          growth ? applyGrowthStrategy(raw as Record<string, any>, growth, affiliateLinks.youtube, episode.id) : raw as Record<string, unknown>,
          episode.id,
          promptVersion,
          isCommercial,
          affiliateLinks,
          spokesmodel,
        );
      } catch (err) {
        lastErrors = [err instanceof Error ? err.message : "JSON inválido"];
        lastInvalidJson = result.text.slice(0, 8000);
        continue;
      }
      const parsed = scriptJsonSchema.safeParse(normalized);

      if (parsed.success) {
        qualityReport = quality.check(parsed.data, research.data, isCommercial);
        await recordScriptQuality(db, episode.id, qualityReport, {
          stage: "generate-script", script_hash: await computeScriptHash(parsed.data),
          policy_hash: quality.policy_hash, attempt,
        });
        if (qualityReport.passed) {
          scriptJson = parsed.data;
          break;
        }
        lastErrors = qualityReport.findings.filter(f => f.severity === "error")
          .map(f => `${f.path}: ${f.message}`);
      } else {
        lastErrors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      }
      lastInvalidJson = JSON.stringify(normalized);
      logger.info("validação do roteiro falhou", { attempt, errors: lastErrors });
    }

    if (!scriptJson) {
      await markEpisodeFailed(
        db,
        logger,
        episode.id,
        qualityReport?.passed === false ? "script_quality_failed" : "json_validation_failed",
        lastErrors.join("; ").slice(0, 1000),
        "research",
      );
      throw new AppError(
        "Roteiro reprovado após repair loop — episódio marcado como failed",
        502,
        qualityReport?.passed === false ? "SCRIPT_QUALITY_FAILED" : "JSON_VALIDATION_FAILED",
      );
    }

    const scriptHash = await computeScriptHash(scriptJson);
    const { data: updated, error: updateError } = await db
      .from("episodes")
      .update({
        script_json: scriptJson,
        script_hash: scriptHash,
        prompt_version: promptVersion,
        metadata: { ...scriptJson.metadata, editorial_style: scriptJson.editorial_style, script_qa: { ...qualityReport, policy_hash: quality.policy_hash, script_hash: scriptHash } },
        status: "script",
      })
      .eq("id", episode.id)
      .eq("status", "research")
      .select("id")
      .maybeSingle();

    if (updateError) {
      // 23505 = colisão de script_hash UNIQUE → roteiro duplicado (idempotência, ADR-005)
      if (updateError.code === "23505") {
        await markEpisodeFailed(db, logger, episode.id, "duplicate_script", `script_hash já existe: ${scriptHash}`, "research");
        throw new AppError("Roteiro duplicado detectado (script_hash colidiu)", 409, "DUPLICATE_SCRIPT");
      }
      throw new AppError(`Erro ao salvar script: ${updateError.message}`, 500, "DB_ERROR");
    }
    if (!updated) throw new AppError("Estado do episódio mudou durante a geração", 409, "INVALID_STATE");

    await logger.event({
      episode_id: episode.id,
      event_type: "script_generated",
      model_used: usedModel,
      prompt_version: promptVersion,
      cost_estimate: 0,
      metadata: { attempts, scenes: scriptJson.scenes.length, script_hash: scriptHash, editorial_style: scriptJson.editorial_style },
    });

    logger.info("script gerado", { episode_id: episode.id, attempts, script_hash: scriptHash });
    return jsonResponse(
      { episode_id: episode.id, script_hash: scriptHash, attempts, scenes: scriptJson.scenes.length },
      200,
    );
  } catch (err) {
    logger?.error("falha no generate-script", err);
    return toErrorResponse(err);
  } finally {
    await release?.();
  }
}
