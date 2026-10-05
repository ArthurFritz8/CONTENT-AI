import { AppError, retryWithBackoff } from "./error-handler.ts";
import { getSystemConfig, createServiceClient } from "./supabase-client.ts";
import { assertGeminiBudget, recordGeminiCall } from "./budget-guard.ts";
import { geminiGenerate } from "./gemini.ts";
import type { JobLogger } from "./logger.ts";

/** Only explicitly free models. Global quotas are shared across workspaces. */
export async function writeStory(db: ReturnType<typeof createServiceClient>, logger: JobLogger,
  prompt: string, episodeId?: string): Promise<{ text: string; model: string }> {
  const cfg = await getSystemConfig<{ text_model?: string }>(db, "gemini", {});
  let lastError: unknown;
  if (Deno.env.get("GEMINI_API_KEY")) {
    const model = cfg.text_model ?? "gemini-3.6-flash";
    try {
      const result = await geminiGenerate({ model, prompt, temperature: 0.7,
        beforeRequest: () => assertGeminiBudget(db, logger, episodeId, "text", model) });
      await recordGeminiCall(logger, episodeId, "text", model, result.usage);
      return { text: result.text, model };
    } catch (error) {
      if (error instanceof AppError && !["BUDGET_EXCEEDED", "GEMINI_CALL_FAILED", "GEMINI_EMPTY_RESPONSE"].includes(error.code)) throw error;
      lastError = error;
      logger.info("Roteirista primário indisponível; consultando alternativa gratuita", { provider: "gemini" });
    }
  }
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (key) {
    const config = await getSystemConfig<{ openrouter_models?: string[] }>(db, "story_production", {});
    const models = [...new Set(config.openrouter_models ?? [])].filter(m => m.endsWith(":free")).slice(0, 2);
    // Verify current prices; a renamed or removed model cannot silently cost money.
    const catalogResponse = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10000) });
    if (!catalogResponse.ok) throw new AppError("Não foi possível verificar modelos gratuitos", 502, "STORY_PROVIDER_UNAVAILABLE");
    const catalog = await catalogResponse.json();
    for (const model of models) {
      const entry = catalog.data?.find((m: { id: string }) => m.id === model);
      if (!entry || Number(entry.pricing?.prompt) !== 0 || Number(entry.pricing?.completion) !== 0 || Number(entry.pricing?.request ?? 0) !== 0) continue;
      try {
        const result = await retryWithBackoff(async () => {
          const { data, error } = await db.rpc("reserve_story_provider_call");
          if (error) throw new AppError("Falha ao reservar cota", 500, "DB_ERROR");
          if (!data) throw new AppError("Cota gratuita de roteiros indisponível", 429, "BUDGET_EXCEEDED");
          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST", signal: AbortSignal.timeout(30000),
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 4500,
              provider: { max_price: { prompt: 0, completion: 0 } } }),
          });
          await logger.event({ ...(episodeId ? { episode_id: episodeId } : {}), event_type: "ai_provider_call",
            model_used: model, cost_estimate: 0, metadata: { provider: "openrouter", http_status: res.status } });
          // 429/402 pause instead of rotating around the account quota.
          if ([402, 429].includes(res.status)) throw new AppError("Cota do roteirista gratuito indisponível. Tente mais tarde.", 429, "BUDGET_EXCEEDED");
          if (!res.ok) throw new AppError("Roteirista alternativo indisponível", res.status >= 500 ? 502 : 500, "STORY_PROVIDER_UNAVAILABLE");
          const json = await res.json();
          const text = json.choices?.[0]?.message?.content;
          if (typeof text !== "string" || !text.trim()) throw new AppError("Roteiro vazio", 502, "STORY_PROVIDER_UNAVAILABLE");
          return { text, model };
        }, { retries: 1, shouldRetry: e => e instanceof AppError && e.status === 502 });
        return result;
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 502) throw e;
        lastError = e;
      }
    }
  }
  throw lastError ?? new AppError("Nenhum roteirista gratuito disponível", 429, "BUDGET_EXCEEDED");
}
