import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  alignWordsProportional,
  resolveWordTimings,
  timingsFromBoundaries,
} from "./subtitle-timing.ts";

test("proporcional: cobre exatamente a duração do áudio, sem drift", () => {
  const timings = alignWordsProportional("Olá mundo incrível de hoje.", 10);
  strictEqual(timings.length, 5);
  strictEqual(timings[0]!.start_seconds, 0);
  strictEqual(timings[timings.length - 1]!.end_seconds, 10);
  for (let i = 1; i < timings.length; i++) {
    strictEqual(timings[i]!.start_seconds, timings[i - 1]!.end_seconds);
  }
});

test("proporcional: palavra longa dura mais que palavra curta", () => {
  const timings = alignWordsProportional("eu impressionantemente", 5);
  const [curta, longa] = timings;
  ok(longa!.end_seconds - longa!.start_seconds > curta!.end_seconds - curta!.start_seconds);
});

test("proporcional: pontuação adiciona pausa", () => {
  const comPausa = alignWordsProportional("fim. tchau", 6);
  const semPausa = alignWordsProportional("fims tchau", 6);
  ok(
    comPausa[0]!.end_seconds - comPausa[0]!.start_seconds >
      semPausa[0]!.end_seconds - semPausa[0]!.start_seconds,
  );
});

test("proporcional: texto vazio ou duração inválida → vazio", () => {
  deepStrictEqual(alignWordsProportional("  ", 10), []);
  deepStrictEqual(alignWordsProportional("olá", 0), []);
});

test("boundaries do Edge TTS têm prioridade sobre proporcional", () => {
  const boundaries = [
    { word: "Olá", offset_seconds: 0.1, duration_seconds: 0.4 },
    { word: "mundo", offset_seconds: 0.6, duration_seconds: 0.5 },
  ];
  const timings = resolveWordTimings({
    narration_text: "Olá mundo",
    audio_duration_seconds: 2,
    word_boundaries: boundaries,
  });
  deepStrictEqual(timings, timingsFromBoundaries(boundaries));
  strictEqual(timings[1]!.end_seconds, 1.1);
});

test("sem boundaries (Gemini/Piper) cai no proporcional", () => {
  const timings = resolveWordTimings({
    narration_text: "Olá mundo",
    audio_duration_seconds: 2,
    word_boundaries: null,
  });
  strictEqual(timings.length, 2);
  strictEqual(timings[1]!.end_seconds, 2);
});
