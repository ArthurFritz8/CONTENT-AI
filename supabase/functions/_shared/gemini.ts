// Cliente REST do Gemini (sem SDK — fetch + retry). Grounding e responseSchema
// são mutuamente exclusivos na API — por isso o pipeline tem 2 fases (ADR-008).

import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiUsage {
  prompt_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface GeminiResult {
  text: string;
  usage: GeminiUsage;
}

export interface GeminiOptions {
  model: string;
  prompt: string;
  grounding?: boolean;
  responseSchema?: unknown;
  temperature?: number;
}

function getApiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new AppError("GEMINI_API_KEY ausente no ambiente", 500, "CONFIG_MISSING");
  return key;
}

export async function geminiGenerate(opts: GeminiOptions): Promise<GeminiResult> {
  if (opts.grounding && opts.responseSchema) {
    throw new AppError(
      "grounding e responseSchema não podem ser combinados na mesma chamada",
      500,
      "INVALID_GEMINI_OPTIONS",
    );
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    ...(opts.grounding ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.responseSchema
        ? { responseMimeType: "application/json", responseSchema: opts.responseSchema }
        : {}),
    },
  };

  return await retryWithBackoff(
    async () => {
      const res = await fetch(
        `${API_BASE}/models/${opts.model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": getApiKey() },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new AppError(
          `Gemini ${opts.model} falhou (${res.status}): ${detail}`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "GEMINI_CALL_FAILED",
        );
      }
      const json = await res.json();
      const parts: Array<{ text?: string }> = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("");
      if (!text) {
        throw new AppError("Gemini retornou resposta vazia", 502, "GEMINI_EMPTY_RESPONSE");
      }
      const usage = json?.usageMetadata ?? {};
      return {
        text,
        usage: {
          prompt_tokens: usage.promptTokenCount,
          output_tokens: usage.candidatesTokenCount,
          total_tokens: usage.totalTokenCount,
        },
      };
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}

/** Extrai JSON de respostas que possam vir com cercas markdown. */
export function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AppError("Resposta do Gemini não é JSON parseável", 502, "GEMINI_INVALID_JSON");
  }
}
