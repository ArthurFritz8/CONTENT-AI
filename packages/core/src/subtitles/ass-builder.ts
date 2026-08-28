// Gerador de legendas .ass (ADR-010): word-by-word com highlight e pop-in.
// .srt foi vetado — não suporta posicionamento, cor nem animação.

import type { WordTiming } from "./subtitle-timing.ts";

export interface SubtitleStyle {
  play_res_x: number;
  play_res_y: number;
  font_name: string;
  font_size: number;
  words_per_group: number;
  outline_px: number;
  margin_v: number;
}

export const SUBTITLE_STYLE_PORTRAIT: SubtitleStyle = {
  play_res_x: 1080,
  play_res_y: 1920,
  font_name: "Arial",
  font_size: 72,
  words_per_group: 3,
  outline_px: 3,
  margin_v: 400, // acima da UI do TikTok/Shorts
};

export const SUBTITLE_STYLE_LANDSCAPE: SubtitleStyle = {
  play_res_x: 1920,
  play_res_y: 1080,
  font_name: "Arial",
  font_size: 44,
  words_per_group: 4,
  outline_px: 3,
  margin_v: 60,
};

// #FFD700 em BGR do formato .ass
const HIGHLIGHT_COLOR = "&H00D7FF&";
const WHITE = "&HFFFFFF&";
// pop-in com bounce aproximado + fade-out
const EVENT_EFFECT = "\\fad(80,60)\\t(0,80,\\fscx112\\fscy112)\\t(80,160,\\fscx100\\fscy100)";

export interface SceneSubtitleInput {
  words: WordTiming[];
  scene_start_seconds: number;
  highlight_words: string[];
  subtitle_position: "bottom_center" | "bottom_left";
}

export function formatAssTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

function normalizeForMatch(word: string): string {
  return word.toLowerCase().replace(/[,.;:!?…"']+$/, "").replace(/^["']+/, "");
}

function renderGroupText(words: WordTiming[], highlightWords: string[]): string {
  const highlights = new Set(highlightWords.map(normalizeForMatch));
  return words
    .map((w) => {
      const text = escapeAssText(w.word);
      return highlights.has(normalizeForMatch(w.word))
        ? `{\\c${HIGHLIGHT_COLOR}}${text}{\\c${WHITE}}`
        : text;
    })
    .join(" ");
}

/** Uma track .ass para o episódio inteiro; offsets das cenas já aplicados. */
export function buildAssSubtitles(
  scenes: SceneSubtitleInput[],
  style: SubtitleStyle,
): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${style.play_res_x}
PlayResY: ${style.play_res_y}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font_name},${style.font_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${style.outline_px},1,2,60,60,${style.margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (const scene of scenes) {
    const alignment = scene.subtitle_position === "bottom_left" ? "\\an1" : "\\an2";
    for (let i = 0; i < scene.words.length; i += style.words_per_group) {
      const group = scene.words.slice(i, i + style.words_per_group);
      const start = scene.scene_start_seconds + group[0]!.start_seconds;
      const end = scene.scene_start_seconds + group[group.length - 1]!.end_seconds;
      const text = `{${alignment}${EVENT_EFFECT}}${renderGroupText(group, scene.highlight_words)}`;
      lines.push(
        `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`,
      );
    }
  }

  return header + lines.join("\n") + "\n";
}
