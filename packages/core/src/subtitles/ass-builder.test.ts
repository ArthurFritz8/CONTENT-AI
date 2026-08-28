import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  buildAssSubtitles,
  formatAssTime,
  SUBTITLE_STYLE_LANDSCAPE,
  SUBTITLE_STYLE_PORTRAIT,
} from "./ass-builder.ts";
import type { WordTiming } from "./subtitle-timing.ts";

const words = (texts: string[], perWord = 0.5): WordTiming[] =>
  texts.map((word, i) => ({
    word,
    start_seconds: i * perWord,
    end_seconds: (i + 1) * perWord,
  }));

test("formatAssTime: horas, minutos e centisegundos", () => {
  strictEqual(formatAssTime(0), "0:00:00.00");
  strictEqual(formatAssTime(61.257), "0:01:01.26");
  strictEqual(formatAssTime(3600.5), "1:00:00.50");
});

test("agrupa palavras conforme o estilo (3 por grupo no portrait)", () => {
  const ass = buildAssSubtitles(
    [{
      words: words(["um", "dois", "três", "quatro", "cinco"]),
      scene_start_seconds: 0,
      highlight_words: [],
      subtitle_position: "bottom_center",
    }],
    SUBTITLE_STYLE_PORTRAIT,
  );
  strictEqual(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length, 2);
});

test("highlight injeta cor amarela e restaura branco (match sem pontuação)", () => {
  const ass = buildAssSubtitles(
    [{
      words: words(["Isso", "é", "incrível."]),
      scene_start_seconds: 0,
      highlight_words: ["incrível"],
      subtitle_position: "bottom_center",
    }],
    SUBTITLE_STYLE_PORTRAIT,
  );
  ok(ass.includes("{\\c&H00D7FF&}incrível.{\\c&HFFFFFF&}"));
});

test("posição vira alignment: bottom_left → an1, bottom_center → an2", () => {
  const base = {
    words: words(["olá"]),
    scene_start_seconds: 0,
    highlight_words: [],
  };
  const left = buildAssSubtitles(
    [{ ...base, subtitle_position: "bottom_left" }],
    SUBTITLE_STYLE_LANDSCAPE,
  );
  const center = buildAssSubtitles(
    [{ ...base, subtitle_position: "bottom_center" }],
    SUBTITLE_STYLE_PORTRAIT,
  );
  ok(left.includes("{\\an1"));
  ok(center.includes("{\\an2"));
});

test("offset da cena desloca os tempos dos eventos", () => {
  const ass = buildAssSubtitles(
    [{
      words: words(["olá", "mundo"]),
      scene_start_seconds: 30,
      highlight_words: [],
      subtitle_position: "bottom_center",
    }],
    SUBTITLE_STYLE_PORTRAIT,
  );
  ok(ass.includes("Dialogue: 0,0:00:30.00,0:00:31.00"));
});

test("remove chaves do texto (injeção de override tags)", () => {
  const ass = buildAssSubtitles(
    [{
      words: words(["{\\b1}hack"]),
      scene_start_seconds: 0,
      highlight_words: [],
      subtitle_position: "bottom_center",
    }],
    SUBTITLE_STYLE_PORTRAIT,
  );
  ok(!ass.includes("{\\b1}"));
});
