// Budget guard por tipo de chamada Gemini (ADR-008): cada chamada vira um
// job_event 'gemini_call' auditável; a contagem do dia é comparada com
// system_config.budget ANTES de chamar a API.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { getSystemConfig } from "./supabase-client.ts";
import type { JobLogger } from "./logger.ts";
import type { GeminiUsage } from "./gemini.ts";

export type GeminiCallType = "grounding" | "text" | "image" | "tts";

interface BudgetConfig {
  gemini_requests_per_day_max?: number;
  gemini_grounding_requests_per_day_max?: number;
  gemini_image_requests_per_day_max?: number;
  gemini_tts_requests_per_day_max?: number;
  hard_stop_on_exceed?: boolean;
}

// Fallbacks conservadores — valores efetivos em system_config.budget
const FALLBACK_LIMITS: Record<GeminiCallType, number> = {
  grounding: 20,
  text: 100,
  image: 10,
  tts: 50,
};

function limitFor(cfg: BudgetConfig, callType: GeminiCallType): number {
  switch (callType) {
    case "grounding":
      return cfg.gemini_grounding_requests_per_day_max ?? FALLBACK_LIMITS.grounding;
    case "text":
      return cfg.gemini_requests_per_day_max ?? FALLBACK_LIMITS.text;
    case "image":
      return cfg.gemini_image_requests_per_day_max ?? FALLBACK_LIMITS.image;
    case "tts":
      return cfg.gemini_tts_requests_per_day_max ?? FALLBACK_LIMITS.tts;
  }
}

async function countTodayCalls(db: SupabaseClient, callType: GeminiCallType): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await db
    .from("job_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "gemini_call")
    .eq("metadata->>call_type", callType)
    .gte("created_at", todayStart.toISOString());
  if (error) {
    throw new AppError(`Erro ao contar chamadas Gemini: ${error.message}`, 500, "DB_ERROR");
  }
  return count ?? 0;
}

/** Cota restante do dia — usado pelo planner de assets ANTES de gerar (ADR-009). */
export async function getGeminiBudgetRemaining(
  db: SupabaseClient,
  callType: GeminiCallType,
): Promise<number> {
  const cfg = await getSystemConfig<BudgetConfig>(db, "budget", {});
  return Math.max(0, limitFor(cfg, callType) - await countTodayCalls(db, callType));
}

export async function assertGeminiBudget(
  db: SupabaseClient,
  logger: JobLogger,
  episodeId: string,
  callType: GeminiCallType,
): Promise<void> {
  const cfg = await getSystemConfig<BudgetConfig>(db, "budget", {});
  const limit = limitFor(cfg, callType);
  const count = await countTodayCalls(db, callType);

  if (count >= limit) {
    await logger.event({
      episode_id: episodeId,
      event_type: "budget_exceeded",
      error_message: `Limite diário de chamadas '${callType}' atingido (${count}/${limit})`,
      metadata: { call_type: callType, count, limit },
    });
    throw new AppError(
      `Budget diário de chamadas Gemini '${callType}' atingido (${count}/${limit})`,
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
