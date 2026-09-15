import { claimEpisode } from "../_shared/episode-lease.ts";
import { requireServiceRole } from "../_shared/auth.ts";
// generate-research — Fase 1 (ADR-023): Tavily Search + Gemini Flash.
// idea → research. Salva resultados e claims juntos para revisão humana.

import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { assertGeminiBudget, recordGeminiCall, reserveTavilyCall } from "../_shared/budget-guard.ts";
import { extractJson, geminiGenerate } from "../_shared/gemini.ts";
import { tavilySearch } from "../_shared/tavily.ts";
import { markEpisodeFailed } from "../_shared/episode-utils.ts";
import { buildResearchPrompt } from "../../../packages/core/src/prompts/research-prompt.ts";
import { researchDataSchema, type ResearchData } from "../../../packages/core/src/schemas/research.ts";
import { groundedResearch, researchEvidenceSchema, type ResearchEvidence } from "../../../packages/core/src/validators/research-evidence.ts";

const inputSchema = z.object({ episode_id: z.string().uuid() });

interface NicheConfig {
  name?: string;
  focus?: string;
}
interface GeminiConfig {
  research_model?: string;
  research_max_claims?: number;
  research_max_sources?: number;
}

function researchResponseSchema(maxClaims: number) {
  return {
    type: "ARRAY", minItems: 3, maxItems: maxClaims,
    items: {
      type: "OBJECT",
      properties: {
        claim: { type: "STRING" }, source_url: { type: "STRING" },
        confidence: { type: "NUMBER", minimum: 0, maximum: 1 }, query_used: { type: "STRING" },
      },
      required: ["claim", "source_url", "confidence", "query_used"],
    },
  };
}

export async function handleResearch(req: Request): Promise<Response> {
  try { requireServiceRole(req); } catch (err) { return toErrorResponse(err); }
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let release: (() => Promise<void>) | undefined;
  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-research");
    release = await claimEpisode(db, input.episode_id);

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, briefing")
      .eq("id", input.episode_id)
      .maybeSingle();
    if (error) throw new AppError(`Erro ao buscar episódio: ${error.message}`, 500, "DB_ERROR");
    if (!episode) throw new AppError("Episódio não encontrado", 404, "NOT_FOUND");
    if (episode.status !== "idea") {
      throw new AppError(
        `Episódio em '${episode.status}' — research exige status 'idea'`,
        409,
        "INVALID_STATE",
      );
    }
    const briefingText = (episode.briefing as { text?: string } | null)?.text;
    if (!briefingText) {
      throw new AppError("Episódio sem briefing.text", 422, "MISSING_BRIEFING");
    }

    const niche = await getSystemConfig<NicheConfig>(db, "niche", {});
    const gemini = await getSystemConfig<GeminiConfig>(db, "gemini", {});
    const configuredModel = gemini.research_model ?? "gemini-3.6-flash";
    const maxClaims = Math.min(20, Math.max(3, gemini.research_max_claims ?? 12));
    const search = await tavilySearch({
      query: `${briefingText} ${niche.focus ?? "gadgets e produtos inovadores"}`.slice(0, 400),
      maxResults: Math.min(5, Math.max(3, gemini.research_max_sources ?? 4)),
      beforeRequest: () => reserveTavilyCall(db, logger!, episode.id),
    });
    await logger.event({ episode_id: episode.id, event_type: "tavily_call", cost_estimate: 0,
      metadata: { credits: search.credits, sources: search.sources.length, request_id: search.requestId } });

    const models = [...new Set([configuredModel, "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"])];
    let result: Awaited<ReturnType<typeof geminiGenerate>> | undefined;
    let model = configuredModel;
    let lastModelError: unknown;
    for (const candidate of models) {
      try {
        result = await geminiGenerate({
          beforeRequest: () => assertGeminiBudget(db, logger!, episode.id, "research", candidate),
          model: candidate,
          prompt: buildResearchPrompt({
            briefing: briefingText,
            nicheName: niche.name ?? "gadgets e produtos inovadores",
            focus: niche.focus ?? "produtos que resolvem um problema real de forma criativa",
            maxClaims,
            sources: search.sources,
          }),
          responseSchema: researchResponseSchema(maxClaims),
          temperature: 0.3,
        });
        model = candidate;
        break;
      } catch (err) {
        lastModelError = err;
        if (!(err instanceof AppError) || err.status !== 502) throw err;
        logger.info("modelo de pesquisa indisponível; tentando fallback", { model: candidate });
      }
    }
    if (!result) throw lastModelError ?? new AppError("Nenhum modelo Gemini de pesquisa respondeu", 502, "GEMINI_CALL_FAILED");
    await recordGeminiCall(db, logger, episode.id, "research", model, result.usage);

    let rawResearch: unknown;
    try { rawResearch = extractJson(result.text); } catch {
      await markEpisodeFailed(db, logger, episode.id, "research_validation_failed", "Research retornou JSON inválido", "idea");
      throw new AppError("Research retornou JSON inválido", 502, "RESEARCH_VALIDATION_FAILED");
    }
    const parsed = researchDataSchema.safeParse(rawResearch);
    if (!parsed.success) {
      // Sem repair loop na fase 1: retry refaria o grounding caro — falha auditável,
      // recuperável via transição failed → idea (ADR-002).
      await markEpisodeFailed(
        db,
        logger,
        episode.id,
        "research_validation_failed",
        parsed.error.issues.map((i) => i.message).join("; "),
        "idea",
      );
      throw new AppError("research_data inválido — episódio marcado como failed", 502, "RESEARCH_VALIDATION_FAILED");
    }

    let evidence: ResearchEvidence;
    let grounded: ResearchData;
    try {
      evidence = researchEvidenceSchema.parse({
        version: "2.0.0", provider: "tavily_search", model,
        captured_at: new Date().toISOString(), query: search.query,
        request_id: search.requestId, sources: search.sources, research: parsed.data,
      });
      grounded = groundedResearch(evidence);
    } catch (err) {
      await markEpisodeFailed(db, logger, episode.id, "research_evidence_failed",
        err instanceof Error ? err.message.slice(0, 1000) : "Evidência inválida", "idea");
      throw new AppError("Pesquisa sem evidência válida para todos os claims", 502, "RESEARCH_EVIDENCE_FAILED");
    }

    const { data: updated, error: updateError } = await db
      .from("episodes")
      .update({ research_data: grounded, research_evidence: evidence, status: "research" })
      .eq("id", episode.id)
      .eq("status", "idea")
      .select("id")
      .maybeSingle();
    if (updateError) {
      throw new AppError(`Erro ao salvar research: ${updateError.message}`, 500, "DB_ERROR");
    }
    if (!updated) throw new AppError("Estado do episódio mudou durante a pesquisa", 409, "INVALID_STATE");

    await logger.event({
      episode_id: episode.id,
      event_type: "research_completed",
      model_used: model,
      cost_estimate: 0,
      metadata: { claims: grounded.length, evidence_version: evidence.version,
        factual_verification: "requires_human_review", ...result.usage },
    });

    logger.info("research concluída", { episode_id: episode.id, claims: parsed.data.length });
    return jsonResponse({ episode_id: episode.id, claims: parsed.data.length }, 200);
  } catch (err) {
    logger?.error("falha no generate-research", err);
    return toErrorResponse(err);
  } finally {
    await release?.();
  }
}
