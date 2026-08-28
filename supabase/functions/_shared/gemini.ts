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

export interface GeminiImageResult {
  bytes: Uint8Array;
  mimeType: string;
  usage: GeminiUsage;
}

export interface GeminiTtsResult {
  bytes: Uint8Array;
  mimeType: string;
  duration_seconds: number;
  usage: GeminiUsage;
}

function usageFromMetadata(usage: Record<string, unknown>): GeminiUsage {
  return {
    prompt_tokens: usage.promptTokenCount as number | undefined,
    output_tokens: usage.candidatesTokenCount as number | undefined,
    total_tokens: usage.totalTokenCount as number | undefined,
  };
}

function sampleRateFromMime(mimeType: string): number {
  return Number(mimeType.match(/rate=(\d+)/)?.[1] ?? 24000);
}

function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(header.byteLength + pcm.byteLength);
  wav.set(header, 0);
  wav.set(pcm, header.byteLength);
  return wav;
}

function wavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  return byteRate > 0 ? dataBytes / byteRate : 0;
}

/** Nano Banana: retorna a imagem como inlineData base64 (ADR-009). */
export async function geminiGenerateImage(
  opts: { model: string; prompt: string },
): Promise<GeminiImageResult> {
  return await retryWithBackoff(
    async () => {
      const res = await fetch(
        `${API_BASE}/models/${opts.model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": getApiKey() },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          }),
        },
      );
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new AppError(
          `Gemini imagem ${opts.model} falhou (${res.status}): ${detail}`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "GEMINI_IMAGE_CALL_FAILED",
        );
      }
      const json = await res.json();
      const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
        json?.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) {
        throw new AppError("Gemini não retornou imagem", 502, "GEMINI_NO_IMAGE");
      }
      const usage = json?.usageMetadata ?? {};
      return {
        bytes: Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0)),
        mimeType: inline.mimeType ?? "image/png",
        usage: usageFromMetadata(usage),
      };
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}

/** Gemini TTS: áudio vem como inlineData; PCM L16 é encapsulado em WAV para o FFmpeg. */
export async function geminiGenerateTts(
  opts: { model: string; prompt: string; voiceName: string },
): Promise<GeminiTtsResult> {
  return await retryWithBackoff(
    async () => {
      const res = await fetch(
        `${API_BASE}/models/${opts.model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": getApiKey() },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } },
              },
            },
          }),
        },
      );
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new AppError(
          `Gemini TTS ${opts.model} falhou (${res.status}): ${detail}`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "GEMINI_TTS_CALL_FAILED",
        );
      }
      const json = await res.json();
      const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
        json?.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new AppError("Gemini TTS não retornou áudio", 502, "GEMINI_TTS_NO_AUDIO");

      const mimeType = inline.mimeType ?? "audio/wav";
      const raw = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0));
      const bytes = mimeType.toLowerCase().startsWith("audio/l16")
        ? wavFromPcm16(raw, sampleRateFromMime(mimeType))
        : raw;
      const normalizedMime = mimeType.toLowerCase().startsWith("audio/l16") ? "audio/wav" : mimeType;
      const duration = normalizedMime.includes("wav") ? wavDurationSeconds(bytes) : 0;
      if (duration <= 0) throw new AppError("Duração do áudio Gemini TTS não detectada", 502, "TTS_DURATION_MISSING");

      return {
        bytes,
        mimeType: normalizedMime,
        duration_seconds: duration,
        usage: usageFromMetadata(json?.usageMetadata ?? {}),
      };
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}
