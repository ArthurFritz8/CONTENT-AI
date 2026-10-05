import { AppError } from "./error-handler.ts";
import { geminiGenerateTts, type GeminiUsage } from "./gemini.ts";

export type TtsEngine = "gemini" | "edge" | "piper";

export interface TtsWordBoundary {
  word: string;
  offset_seconds: number;
  duration_seconds: number;
}

export interface TtsConfig {
  scene_voices?: Record<number, string>;
  chain?: TtsEngine[];
  voice_pt_br?: string;
  gemini_tts_model?: string;
  gemini_tts_voice?: string;
  delivery_style?: string;
  edge_rate?: string;
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

export function voiceDirectionForStyle(style: string): { delivery: string; edgeRate: string } {
  switch (style) {
    case "hook_choque_ritmo_rapido": return { delivery: "enérgica e curiosa, com frases claras e pausas curtas", edgeRate: "+3%" };
    case "storytelling_pessoal": return { delivery: "próxima e conversacional, com pausas naturais", edgeRate: "-2%" };
    case "comparacao_lado_a_lado": return { delivery: "objetiva, destacando as diferenças sem pressa", edgeRate: "+0%" };
    case "mito_vs_verdade": return { delivery: "curiosa e precisa, destacando a evidência", edgeRate: "+1%" };
    case "unboxing_primeira_impressao": return { delivery: "curiosa e descritiva, sem fingir experiência pessoal", edgeRate: "+1%" };
    case "explicativo_pausado": return { delivery: "didática e calma, com pausas para compreensão", edgeRate: "-4%" };
    default: return { delivery: "natural e clara, em tom de conversa", edgeRate: "+0%" };
  }
}

export function geminiSpeechPrompt(text: string, delivery: string): string {
  return `Leia em português brasileiro com voz ${delivery}. Preserve exatamente o texto e suas pausas; não acrescente comentários. Texto a narrar:\n${text}`;
}

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
      prompt: geminiSpeechPrompt(text, cfg.delivery_style ?? "natural e clara, em tom de conversa"),
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
