// Budget guard por tipo de chamada Gemini (ADR-008): cada chamada vira um
// job_event 'gemini_call' auditável; a contagem do dia é comparada com
// system_config.budget ANTES de chamar a API.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { getSystemConfig } from "./supabase-client.ts";
import type { JobLogger } from "./logger.ts";
import type { GeminiUsage } from "./gemini.ts";

export type GeminiCallType = "grounding" | "research" | "text" | "image" | "tts";

interface BudgetConfig {
  gemini_requests_per_day_max?: number;
  gemini_grounding_requests_per_day_max?: number;
  gemini_research_requests_per_day_max?: number;
  gemini_image_requests_per_day_max?: number;
  gemini_tts_requests_per_day_max?: number;
  hard_stop_on_exceed?: boolean;
}

// Fallbacks conservadores — valores efetivos em system_config.budget
const FALLBACK_LIMITS: Record<GeminiCallType, number> = {
  grounding: 0,
  research: 0,
  text: 0,
  image: 0,
  tts: 0,
};

function limitFor(cfg: BudgetConfig, callType: GeminiCallType): number {
  switch (callType) {
    case "grounding":
      return cfg.gemini_grounding_requests_per_day_max ?? FALLBACK_LIMITS.grounding;
    case "research":
      return cfg.gemini_research_requests_per_day_max ?? FALLBACK_LIMITS.research;
    case "text":
      return cfg.gemini_requests_per_day_max ?? FALLBACK_LIMITS.text;
    case "image":
      return cfg.gemini_image_requests_per_day_max ?? FALLBACK_LIMITS.image;
    case "tts":
      return cfg.gemini_tts_requests_per_day_max ?? FALLBACK_LIMITS.tts;
  }
}

export async function reserveTavilyCall(
  db: SupabaseClient,
  logger: JobLogger,
  episodeId: string,
): Promise<void> {
  const { data, error } = await db.rpc("reserve_tavily_call");
  if (error) throw new AppError("Falha ao reservar quota Tavily", 500, "DB_ERROR");
  if (data !== true) {
    await logger.event({ episode_id: episodeId, event_type: "budget_exceeded",
      error_message: "Quota Tavily indisponível", metadata: { provider: "tavily" } });
    throw new AppError("Quota Tavily indisponível", 429, "BUDGET_EXCEEDED");
  }
}

async function countTodayCalls(db: SupabaseClient, callType: GeminiCallType): Promise<number> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data, error } = await db
    .from("api_budget_usage")
    .select("used")
    .eq("scope", `gemini:kind:${callType}`)
    .eq("period", day)
    .maybeSingle();
  if (error) {
    throw new AppError(`Erro ao contar chamadas Gemini: ${error.message}`, 500, "DB_ERROR");
  }
  return data?.used ?? 0;
}

/** Cota restante do dia — usado pelo planner de assets ANTES de gerar (ADR-009). */
export async function getGeminiBudgetRemaining(
  db: SupabaseClient,
  callType: GeminiCallType,
): Promise<number> {
  if (callType === "image") return 0; // No free image API; cannot be enabled by a seed flag.
  const cfg = await getSystemConfig<BudgetConfig>(db, "budget", {});
  return Math.max(0, limitFor(cfg, callType) - await countTodayCalls(db, callType));
}

export async function assertGeminiBudget(
  db: SupabaseClient,
  logger: JobLogger,
  episodeId: string,
  callType: GeminiCallType,
  model: string,
): Promise<void> {
  const { data, error } = await db.rpc("reserve_gemini_call", { p_kind: callType, p_model: model });
  if (error) throw new AppError("Falha ao reservar quota Gemini", 500, "DB_ERROR");
  if (data !== true) {
    await logger.event({
      episode_id: episodeId,
      event_type: "budget_exceeded",
      error_message: `Quota indisponível para '${callType}' / ${model}`,
      metadata: { call_type: callType, model },
    });
    throw new AppError(
      `Quota Gemini '${callType}' indisponível (RPD/RPM/configuração)`,
      429,
      "BUDGET_EXCEEDED",
    );
  }
}

export async function recordGeminiCall(
  logger: JobLogger,
  episodeId: string,
  callType: GeminiCallType,
  model: string,
  usage: GeminiUsage,
): Promise<void> {
  await logger.event({
    episode_id: episodeId,
    event_type: "gemini_call",
    model_used: model,
    cost_estimate: 0, // free tier
    metadata: { call_type: callType, ...usage },
  });
}
