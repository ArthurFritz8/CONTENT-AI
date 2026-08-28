// Timing de legendas sem Whisper (ADR-010): boundaries nativas do Edge TTS
// quando existirem; senão alinhamento proporcional ponderado por tamanho da palavra.

export interface WordTiming {
  word: string;
  start_seconds: number;
  end_seconds: number;
}

export interface TtsWordBoundary {
  word: string;
  offset_seconds: number;
  duration_seconds: number;
}

// Peso em "chars equivalentes": palavra longa fala-se mais devagar;
// pontuação final gera pausa natural que a divisão uniforme ignora.
const BASE_WEIGHT_CHARS = 1;
const PAUSE_WEIGHT_CHARS = 3;
const PAUSE_PUNCTUATION = /[,.;:!?…]$/;

export function timingsFromBoundaries(boundaries: TtsWordBoundary[]): WordTiming[] {
  return boundaries.map((b) => ({
    word: b.word,
    start_seconds: b.offset_seconds,
    end_seconds: b.offset_seconds + b.duration_seconds,
  }));
}

export function alignWordsProportional(
  narrationText: string,
  audioDurationSeconds: number,
): WordTiming[] {
  const words = narrationText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || audioDurationSeconds <= 0) return [];

  const weights = words.map(
    (w) => w.length + BASE_WEIGHT_CHARS + (PAUSE_PUNCTUATION.test(w) ? PAUSE_WEIGHT_CHARS : 0),
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const timings: WordTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const duration = (weights[i]! / totalWeight) * audioDurationSeconds;
    timings.push({
      word: words[i]!,
      start_seconds: cursor,
      end_seconds: cursor + duration,
    });
    cursor += duration;
  }
  // elimina drift de ponto flutuante no fim do áudio
  timings[timings.length - 1]!.end_seconds = audioDurationSeconds;
  return timings;
}

/** Boundaries disponíveis (Edge TTS) → exatas; senão proporcional (Gemini/Piper). */
export function resolveWordTimings(input: {
  narration_text: string;
  audio_duration_seconds: number;
  word_boundaries?: TtsWordBoundary[] | null;
}): WordTiming[] {
  if (input.word_boundaries && input.word_boundaries.length > 0) {
    return timingsFromBoundaries(input.word_boundaries);
  }
  return alignWordsProportional(input.narration_text, input.audio_duration_seconds);
}
