import { z } from "zod";
import { requireServiceRole } from "../_shared/auth.ts";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { reserveTavilyCall, assertGeminiBudget, recordGeminiCall } from "../_shared/budget-guard.ts";
import { tavilySearch } from "../_shared/tavily.ts";
import { geminiGenerate, extractJson } from "../_shared/gemini.ts";
import { recommendationPrompt, supportedRecommendations } from "../_shared/idea-recommendations.ts";
import { parseJsonBody } from "../_shared/validators.ts";

const inputSchema = z.object({ idea_id: z.string().uuid() });
const responseSchema = {
  type: "ARRAY", maxItems: 3, items: { type: "OBJECT",
    properties: {
      product_name: { type: "STRING" }, hook: { type: "STRING" },
      problem: { type: "STRING" }, limitation: { type: "STRING" },
      why_now: { type: "STRING" }, source_url: { type: "STRING" },
    },
    required: ["product_name", "hook", "problem", "limitation", "why_now", "source_url"],
  },
};

export async function handleRecommendIdea(req: Request): Promise<Response> {
  try { requireServiceRole(req); } catch (err) { return toErrorResponse(err); }
  if (req.method !== "POST") return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  const db = createServiceClient();
  const logger = new JobLogger(db, "recommend-idea");
  try {
    const input = await parseJsonBody(req, inputSchema);
    const { data: idea, error } = await db.from("idea_queue")
      .select("id,briefing,status,source,revision,recommendations")
      .eq("id", input.idea_id).maybeSingle();
    if (error) throw new AppError("Falha ao ler pauta", 500, "DB_ERROR");
    if (!idea || idea.status !== "pending" || idea.source !== "trend_discovery")
      throw new AppError("Candidato indisponível", 409, "INVALID_CANDIDATE");
    if (Array.isArray(idea.recommendations) && idea.recommendations.length)
      return jsonResponse({ recommendations: idea.recommendations, revision: idea.revision, cached: true });

    const title = idea.briefing.match(/[“"]([^”"]{15,250})[”"]/)?.[1]
      ?? idea.briefing.slice(0, 180);
    const search = await tavilySearch({
      query: `${title} marca modelo produto gadget`.slice(0, 350), maxResults: 5,
      beforeRequest: () => reserveTavilyCall(db, logger),
    });
    const gemini = await getSystemConfig<{ research_model?: string }>(db, "gemini", {});
    const models = [...new Set([
      gemini.research_model ?? "gemini-3.6-flash",
      "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash",
    ])];
    let output: Awaited<ReturnType<typeof geminiGenerate>> | undefined;
    let model = models[0];
    let lastModelError: unknown;
    for (const candidate of models) {
      try {
        output = await geminiGenerate({
          model: candidate, temperature: 0.2, responseSchema,
          prompt: recommendationPrompt(idea.briefing, search.sources),
          beforeRequest: () => assertGeminiBudget(db, logger, undefined, "research", candidate),
        });
        model = candidate;
        break;
      } catch (error) {
        lastModelError = error;
        if (!(error instanceof AppError) || error.status !== 502) throw error;
        logger.info("modelo de recomendação indisponível; tentando fallback", { model: candidate });
      }
    }
    if (!output) throw lastModelError ?? new AppError("Nenhum modelo de recomendação respondeu", 502, "GEMINI_CALL_FAILED");
    await recordGeminiCall(logger, undefined, "research", model, output.usage);
    const recommendations = supportedRecommendations(extractJson(output.text), search.sources);
    const { data: saved, error: saveError } = await db.from("idea_queue")
      .update({ recommendations, recommendation_checked_at: new Date().toISOString() })
      .eq("id", idea.id).eq("status", "pending").eq("revision", idea.revision)
      .select("id,revision").maybeSingle();
    if (saveError) throw new AppError("Falha ao salvar recomendações", 500, "DB_ERROR");
    if (!saved) throw new AppError("Pauta mudou durante a análise", 409, "CANDIDATE_CHANGED");
    await logger.event({ event_type: "trend_discovered", metadata: {
      idea_id: idea.id, phase: "concrete_recommendations", count: recommendations.length,
      source_count: search.sources.length, model,
    } });
    return jsonResponse({ recommendations, revision: saved.revision, cached: false });
  } catch (err) {
    logger.error("falha ao recomendar produtos", err);
    return toErrorResponse(err);
  }
}
