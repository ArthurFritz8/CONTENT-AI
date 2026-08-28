import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";
import { geminiGenerateTts, type GeminiUsage } from "./gemini.ts";

export type TtsEngine = "gemini" | "edge" | "piper";

export interface TtsWordBoundary {
  word: string;
  offset_seconds: number;
  duration_seconds: number;
}

export interface TtsConfig {
  chain?: TtsEngine[];
  voice_pt_br?: string;
  gemini_tts_model?: string;
  gemini_tts_voice?: string;
  edge_endpoint_url?: string | null;
  piper_endpoint_url?: string | null;
  preflight_enabled?: boolean;
  preflight_text?: string;
  duration_deviation_warn_percent?: number;
}

export interface TtsResult {
  engine: TtsEngine;
  bytes: Uint8Array;
  mimeType: string;
  extension: "wav" | "mp3";
  duration_seconds: number;
  word_boundaries: TtsWordBoundary[] | null;
  usage?: GeminiUsage;
}

export const DEFAULT_TTS_CHAIN: TtsEngine[] = ["gemini", "edge", "piper"];

export function normalizeTtsChain(chain: TtsConfig["chain"]): TtsEngine[] {
  const valid = (chain ?? DEFAULT_TTS_CHAIN).filter((e): e is TtsEngine =>
    e === "gemini" || e === "edge" || e === "piper"
  );
  return valid.length > 0 ? valid : DEFAULT_TTS_CHAIN;
}

export function sourceForTtsEngine(engine: TtsEngine): "gemini" | "edge" | "piper" {
  return engine;
}

function extensionFromMime(mimeType: string): "wav" | "mp3" {
  return mimeType.toLowerCase().includes("mpeg") || mimeType.toLowerCase().includes("mp3") ? "mp3" : "wav";
}

function lastBoundaryEnd(boundaries: TtsWordBoundary[] | null | undefined): number {
  return boundaries?.reduce((max, b) => Math.max(max, b.offset_seconds + b.duration_seconds), 0) ?? 0;
}

function wavDurationSeconds(bytes: Uint8Array): number {
  if (bytes.byteLength < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  return byteRate > 0 ? dataBytes / byteRate : 0;
}

function normalizeBoundaries(raw: unknown): TtsWordBoundary[] | null {
  if (!Array.isArray(raw)) return null;
  const boundaries = raw.filter((item): item is TtsWordBoundary =>
    item && typeof item.word === "string" &&
    typeof item.offset_seconds === "number" &&
    typeof item.duration_seconds === "number"
  );
  return boundaries.length > 0 ? boundaries : null;
}

async function synthesizeExternal(
  engine: Exclude<TtsEngine, "gemini">,
  endpointUrl: string | null | undefined,
  text: string,
  voice: string,
): Promise<TtsResult> {
  if (!endpointUrl) {
    throw new AppError(`Endpoint ${engine} TTS não configurado`, 503, "TTS_ENGINE_UNAVAILABLE");
  }
  return await retryWithBackoff(
    async () => {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        throw new AppError(
          `${engine} TTS falhou (${res.status})`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "TTS_CALL_FAILED",
        );
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        if (!json?.audio_base64) throw new AppError(`${engine} TTS sem audio_base64`, 502, "TTS_NO_AUDIO");
        const bytes = Uint8Array.from(atob(json.audio_base64), (c) => c.charCodeAt(0));
        const mimeType = json.mime_type ?? "audio/mpeg";
        const word_boundaries = normalizeBoundaries(json.word_boundaries);
        const duration = Number(json.duration_seconds ?? 0) || lastBoundaryEnd(word_boundaries) || wavDurationSeconds(bytes);
        if (duration <= 0) throw new AppError(`${engine} TTS sem duration_seconds`, 502, "TTS_DURATION_MISSING");
        return { engine, bytes, mimeType, extension: extensionFromMime(mimeType), duration_seconds: duration, word_boundaries };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const duration = wavDurationSeconds(bytes);
      if (duration <= 0) throw new AppError(`${engine} TTS binário sem duração detectável`, 502, "TTS_DURATION_MISSING");
      return { engine, bytes, mimeType: contentType, extension: extensionFromMime(contentType), duration_seconds: duration, word_boundaries: null };
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}

export async function synthesizeTts(
  engine: TtsEngine,
  text: string,
  cfg: TtsConfig,
): Promise<TtsResult> {
  if (engine === "gemini") {
    const result = await geminiGenerateTts({
      model: cfg.gemini_tts_model ?? "gemini-2.5-flash-preview-tts",
      prompt: text,
      voiceName: cfg.gemini_tts_voice ?? "Kore",
    });
    return {
      engine,
      bytes: result.bytes,
      mimeType: result.mimeType,
      extension: extensionFromMime(result.mimeType),
      duration_seconds: result.duration_seconds,
      word_boundaries: null,
      usage: result.usage,
    };
  }

  return await synthesizeExternal(
    engine,
    engine === "edge" ? cfg.edge_endpoint_url : cfg.piper_endpoint_url,
    text,
    cfg.voice_pt_br ?? "pt-BR-FranciscaNeural",
  );
}