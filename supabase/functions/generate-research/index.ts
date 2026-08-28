// generate-research — Fase 1 (ADR-008): Gemini Flash + Google Search grounding.
// idea → research. Salva claims verificados em episodes.research_data (checkpoint).

import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { assertGeminiBudget, recordGeminiCall } from "../_shared/budget-guard.ts";
import { extractJson, geminiGenerate } from "../_shared/gemini.ts";
import { markEpisodeFailed } from "../_shared/episode-utils.ts";
import { buildResearchPrompt } from "../../../packages/core/src/prompts/research-prompt.ts";
import { researchDataSchema } from "../../../packages/core/src/schemas/research.ts";

const inputSchema = z.object({ episode_id: z.string().uuid() });

interface NicheConfig {
  name?: string;
  focus?: string;
}
interface GeminiConfig {
  research_model?: string;
  research_max_claims?: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, inputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "generate-research");

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

    await assertGeminiBudget(db, logger, episode.id, "grounding");

    const niche = await getSystemConfig<NicheConfig>(db, "niche", {});
    const gemini = await getSystemConfig<GeminiConfig>(db, "gemini", {});
    const model = gemini.research_model ?? "gemini-2.5-flash";

    const result = await geminiGenerate({
      model,
      prompt: buildResearchPrompt({
        briefing: briefingText,
        nicheName: niche.name ?? "gadgets e produtos inovadores",
        focus: niche.focus ?? "produtos que resolvem um problema real de forma criativa",
        maxClaims: gemini.research_max_claims ?? 12,
      }),
      grounding: true,
      temperature: 0.3,
    });
    await recordGeminiCall(logger, episode.id, "grounding", model, result.usage);

    const parsed = researchDataSchema.safeParse(extractJson(result.text));
    if (!parsed.success) {
      // Sem repair loop na fase 1: retry refaria o grounding caro — falha auditável,
      // recuperável via transição failed → idea (ADR-002).
      await markEpisodeFailed(
        db,
        logger,
        episode.id,
        "research_validation_failed",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
      throw new AppError("research_data inválido — episódio marcado como failed", 502, "RESEARCH_VALIDATION_FAILED");
    }

    const { error: updateError } = await db
      .from("episodes")
      .update({ research_data: parsed.data, status: "research" })
      .eq("id", episode.id);
    if (updateError) {
      throw new AppError(`Erro ao salvar research: ${updateError.message}`, 500, "DB_ERROR");
    }

    await logger.event({
      episode_id: episode.id,
      event_type: "research_completed",
      model_used: model,
      cost_estimate: 0,
      metadata: { claims: parsed.data.length, ...result.usage },
    });

    logger.info("research concluída", { episode_id: episode.id, claims: parsed.data.length });
    return jsonResponse({ episode_id: episode.id, claims: parsed.data.length }, 200);
  } catch (err) {
    logger?.error("falha no generate-research", err);
    return toErrorResponse(err);
  }
});
