import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildAssSubtitles, resolveWordTimings, SUBTITLE_STYLE_PORTRAIT,
  scriptJsonSchema,
} from "@content-ai/core";
import { storyContextSchema } from "../packages/core/src/stories/schema.ts";
import { buildStoryScript } from "../packages/core/src/stories/script.ts";
import { buildConcatList, buildMusicMixFilter, ORIENTATIONS } from "../apps/local-renderer/src/render-utils.ts";
import { assertClipCoverage, buildClipSceneFilterGraph } from "../apps/local-renderer/src/clip-render.ts";
import { assessMedia, type MediaProbe } from "../apps/local-renderer/src/media-quality.ts";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "output/humanized-story-pilot");
const availableOnly = process.argv.includes("--available");
interface Shot {
  id: string; scene: number; speaker: string; text: string; audio: string; words: string;
  audio_seconds: number; gap_seconds: number; frames: number;
}
const plan = JSON.parse(await readFile(join(out, "plan.json"), "utf8")) as {
  title: string; summary: string; shots: Shot[]; measured_duration_seconds: number;
};
function command(name: string, args: string[]): string {
  const result = spawnSync(name, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
  return result.stdout;
}
function probe(path: string): MediaProbe {
  return JSON.parse(command("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]));
}
// Edge TTS includes a quiet tail. Remove only a measured final silence, after
// the last word boundary; keep initial timing and every pause inside the line.
const originalMeasuredDuration = plan.measured_duration_seconds;
const editingCuts: Array<{ shot: string; raw_audio_seconds: number; audio_seconds: number }> = [];
for (const shot of plan.shots) {
  const boundaries = JSON.parse(await readFile(resolve(root, shot.words), "utf8")) as
    Array<{ offset_seconds: number; duration_seconds: number }>;
  const wordEnd = Math.max(...boundaries.map(word => word.offset_seconds + word.duration_seconds));
  if (!Number.isFinite(wordEnd) || wordEnd > shot.audio_seconds + 0.04) throw new Error(`Invalid final word: ${shot.id}`);
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", resolve(root, shot.audio), "-vn",
    "-af", "silencedetect=noise=-45dB:d=0.5", "-f", "null", "-"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot measure silence: ${shot.id}: ${result.stderr}`);
  const silences = Array.from(result.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g));
  const last = silences.at(-1);
  const raw = shot.audio_seconds;
  if (last && Number(last[2]) >= raw - 0.08 && Number(last[1]) >= wordEnd - 0.06) {
    shot.audio_seconds = Math.min(raw, Math.max(wordEnd, Number(last[1])) + 0.15);
  }
  editingCuts.push({ shot: shot.id, raw_audio_seconds: raw, audio_seconds: shot.audio_seconds });
}
plan.measured_duration_seconds = plan.shots.reduce((sum, shot) => sum + shot.audio_seconds + shot.gap_seconds, 0);
if (plan.measured_duration_seconds < 60) throw new Error("Edited chapter falls below the minimum duration");
await writeFile(join(out, "editing-cuts.json"), JSON.stringify({ cuts: editingCuts,
  raw_voice_and_gaps_seconds: originalMeasuredDuration, edited_voice_and_gaps_seconds: plan.measured_duration_seconds,
  last_word_padding_seconds: 0.15, internal_pauses_preserved: true }, null, 2));
command(process.platform === "win32" ? "python" : "python3", [join(root, "scripts/score-story-pilot.py"), "--edited"]);
if (process.platform === "win32") {
  const config = join(out, "fonts.conf");
  await writeFile(config, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${out.replaceAll("\\", "/")}/fontcache</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = config;
}
const identifiersPath = join(out, "preview-identifiers.json");
let identifiers: { series: string; episode: string };
try {
  identifiers = JSON.parse(await readFile(identifiersPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  identifiers = { series: randomUUID(), episode: randomUUID() };
  await writeFile(identifiersPath, JSON.stringify(identifiers));
}
const context = storyContextSchema.parse({ series_id: identifiers.series, chapter_number: 1, previous_summaries: [], bible: {
  title: "Segredos da rua", kind: "fruits", genre: "mystery", premise: plan.summary,
  cast: [
    { id: "malu", name: "Malu", appearance: "apple", color: "#b74737", personality: "Assertiva e observadora; uma briga familiar antiga ainda a magoa.", voice: "female" },
    { id: "laranjito", name: "Laranjito", appearance: "orange", color: "#e29a37", personality: "Bem-humorado e atrapalhado, tenta proteger quem ama mesmo quando esconde a verdade.", voice: "male" },
  ], chapters: [
    { title: plan.title, arc: plan.summary },
    { title: "A visita que ninguém esperava", arc: "Malu decide como enfrentar o retorno do irmão e descobre por que ele voltou ao bairro depois do conflito que separou a família." },
  ],
} });
const visual = { speaker_id: "narrator", on_stage: ["malu", "laranjito"], setting: "street", mood: "surprised" };
const groups = Array.from({ length: 6 }, (_, scene) => plan.shots.filter(s => s.scene === scene));
const script = buildStoryScript({ title: plan.title, summary: plan.summary,
  scenes: groups.map(shots => ({ narration_text: shots.map(s => s.text).join(" "), visual })) }, context, identifiers.episode);
for (const scene of script.scenes) {
  const shots = plan.shots.filter(s => s.scene === scene.order);
  scene.duration_seconds = shots.reduce((sum, s) => sum + s.audio_seconds + s.gap_seconds, 0);
}
script.narration.estimated_duration_seconds = plan.measured_duration_seconds;
scriptJsonSchema.parse(script);
await writeFile(join(out, "preview-script.json"), JSON.stringify({ mode: "local_preview_not_database_episode", script }, null, 2));
await mkdir(join(out, "assembled"), { recursive: true });
const paths: string[] = [];
for (const shot of plan.shots) {
  const clip = join(out, "clips", `${shot.id}.mp4`);
  if (availableOnly) {
    try { await access(clip.replace(/\.mp4$/, ".json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      continue;
    }
  }
  const checkpoint = JSON.parse(await readFile(clip.replace(/\.mp4$/, ".json"), "utf8"));
  const sha = createHash("sha256").update(await readFile(clip)).digest("hex");
  if (sha !== checkpoint.sha256) throw new Error(`Clip ${shot.id}: checksum mismatch`);
  assertClipCoverage(probe(clip), shot.audio_seconds + shot.gap_seconds);
  const words = resolveWordTimings({ narration_text: shot.text, audio_duration_seconds: shot.audio_seconds,
    word_boundaries: JSON.parse(await readFile(resolve(root, shot.words), "utf8")) });
  const ass = join(out, "assembled", `${shot.id}.ass`);
  await writeFile(ass, buildAssSubtitles([{ words, scene_start_seconds: 0,
    highlight_words: ["biscoito", "irmão", "voltou", "segredo"], subtitle_position: "bottom_center" }],
    { ...SUBTITLE_STYLE_PORTRAIT, font_size: 64 }));
  const scenePath = join(out, "assembled", `${shot.id}.mp4`);
  const graph = buildClipSceneFilterGraph({ size: ORIENTATIONS.portrait, subtitlePath: ass,
    audioDuration: shot.audio_seconds, gapSeconds: shot.gap_seconds });
  command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-i", resolve(root, shot.audio),
    "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "19", "-preset", "fast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", scenePath]);
  paths.push(scenePath);
  process.stdout.write(`Assembled shot ${shot.id}\n`);
}
if (availableOnly && paths.length < plan.shots.length) {
  process.stdout.write(`${paths.length}/${plan.shots.length} shots assembled; final episode awaits complete generation.\n`);
  process.exit(0);
}
await writeFile(join(out, "assembled", "concat.txt"), buildConcatList(paths));
const dialogue = join(out, "dialogue.mp4");
command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i",
  join(out, "assembled", "concat.txt"), "-c", "copy", dialogue]);
const final = join(out, "episodio-01-o-biscoito-e-o-segredo.mp4");
command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", dialogue, "-i", join(out, "original-score.wav"),
  "-filter_complex", `${buildMusicMixFilter(0.10)};[a]loudnorm=I=-16:TP=-1.5:LRA=11[voice]`,
  "-map", "0:v", "-map", "[voice]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", final]);
const report = assessMedia(probe(final), "portrait", paths.reduce((sum, path) => sum + Number(probe(path).format?.duration), 0), plan.measured_duration_seconds);
command("ffmpeg", ["-v", "error", "-i", final, "-f", "null", "-"]);
await writeFile(join(out, "episode-qa.json"), JSON.stringify({ ...report, decoded: true, measured_voice_and_gaps: plan.measured_duration_seconds,
  raw_voice_and_gaps: originalMeasuredDuration, trailing_silence_removed_seconds: originalMeasuredDuration - plan.measured_duration_seconds,
  shots: paths.length, source_resolution: { width: 704, height: 1248 }, output_upscaled: true,
  lip_sync_validated: false, synthetic_fiction: true, database_writes: false, published: false,
  sha256: createHash("sha256").update(await readFile(final)).digest("hex"), local_file: pathToFileURL(final).href }, null, 2));
process.stdout.write(`QA passed: ${final}\n`);
