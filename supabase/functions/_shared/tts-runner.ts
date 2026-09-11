import { AppError } from "./error-handler.ts";
import type { TtsConfig, TtsEngine, TtsResult, TtsWordBoundary } from "./tts.ts";

async function command(name: string, args: string[], input?: string): Promise<string> {
  const child = new Deno.Command(name, { args, signal: AbortSignal.timeout(90_000), stdin: input ? "piped" : "null", stdout: "piped", stderr: "piped" }).spawn();
  if (input) { const writer = child.stdin.getWriter(); await writer.write(new TextEncoder().encode(input)); await writer.close(); }
  const result = await child.output();
  if (!result.success) throw new AppError(`${name} não concluiu a síntese`, 502, "TTS_RUNNER_FAILED");
  return new TextDecoder().decode(result.stdout);
}

/** Invoked only on GitHub Actions. No local PC or extra HTTP service is required. */
export async function synthesizeOnRunner(engine: Exclude<TtsEngine, "gemini">, text: string, cfg: TtsConfig): Promise<TtsResult> {
  const dir = await Deno.makeTempDir({ prefix: "content-ai-tts-" });
  try {
    const extension = engine === "edge" ? "mp3" : "wav";
    const path = `${dir}/voice.${extension}`;
    let word_boundaries: TtsWordBoundary[] | null = null;
    if (engine === "edge") {
      const boundaries = `${dir}/words.json`;
      await command("python", ["scripts/synthesize-edge.py"], JSON.stringify({ text, voice: cfg.voice_pt_br ?? "pt-BR-FranciscaNeural", audio: path, boundaries }));
      word_boundaries = JSON.parse(await Deno.readTextFile(boundaries));
    } else {
      const model = Deno.env.get("PIPER_MODEL_PATH");
      if (!model) throw new AppError("Modelo Piper licenciado não provisionado", 503, "TTS_PIPER_MODEL_MISSING");
      await command("python", ["-m", "piper", "--model", model, "--output_file", path], text);
    }
    const duration = Number(await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]));
    if (!Number.isFinite(duration) || duration <= 0) throw new AppError("Áudio sem duração válida", 502, "TTS_DURATION_MISSING");
    return { engine, bytes: await Deno.readFile(path), extension, mimeType: engine === "edge" ? "audio/mpeg" : "audio/wav", duration_seconds: duration, word_boundaries };
  } finally { await Deno.remove(dir, { recursive: true }); }
}
