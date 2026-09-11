import { AppError } from "./error-handler.ts";
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

export async function synthesizeTts(
  engine: TtsEngine,
  text: string,
  cfg: TtsConfig,
  beforeRequest: () => Promise<void>,
): Promise<TtsResult> {
  if (engine === "gemini") {
    const result = await geminiGenerateTts({
      beforeRequest,
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

  if (Deno.env.get("GITHUB_ACTIONS") !== "true") {
    throw new AppError("Fallback TTS exige runner", 202, "ASSETS_RUNNER_REQUIRED");
  }
  const { synthesizeOnRunner } = await import("./tts-runner.ts");
  return await synthesizeOnRunner(engine, text, cfg);
}
