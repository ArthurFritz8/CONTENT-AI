// Local artistic preview, below the episode contract. No DB or publication.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { buildAssSubtitles, resolveWordTimings, SUBTITLE_STYLE_PORTRAIT } from "@content-ai/core";
import { buildConcatList, escapeFfmpegFilterPath } from "../apps/local-renderer/src/render-utils.ts";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "output/audio-driven-conversation");
const assembled = join(out, "assembled");
const availableOnly = process.argv.includes("--available");
await mkdir(assembled, { recursive: true });
interface Shot {
  id: string; text: string; speaker: string; frames: number; audio: string;
  audio_seconds: number; audio_sha256: string; output_frames: number;
  word_boundaries: Array<{ word: string; offset_seconds: number; duration_seconds: number }>;
}
const plan = JSON.parse(await readFile(join(out, "plan.json"), "utf8")) as {
  title: string; shots: Shot[]; published: boolean; database_writes: boolean;
};
if (plan.published || plan.database_writes || plan.shots.map(s => s.id).join() !== "06,07,08,09") {
  throw new Error("Expected isolated approved conversation plan");
}
function command(name: string, args: string[]): string {
  const result = spawnSync(name, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
  return result.stdout;
}
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
if (process.platform === "win32") {
  const fonts = join(out, "fonts.conf");
  await writeFile(fonts, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${out.replaceAll("\\", "/")}/fontcache</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = fonts;
}
const paths: string[] = [];
const cuts: Array<{ id: string; speaker: string; start_seconds: number; seconds: number; frames: number }> = [];
let cursor = 0;
for (const shot of plan.shots) {
  const folder = join(out, shot.id);
  let checkpoint;
  try {
    checkpoint = JSON.parse(await readFile(join(folder, "qa.json"), "utf8"));
  } catch (error) {
    if (availableOnly && (error as NodeJS.ErrnoException).code === "ENOENT") break;
    throw error;
  }
  const audit = JSON.parse(await readFile(join(folder, "av-audit.json"), "utf8"));
  const clip = join(folder, "fluid.mp4");
  if (hash(await readFile(clip)) !== checkpoint.outputs.fluid.sha256 ||
      hash(await readFile(resolve(root, shot.audio))) !== shot.audio_sha256 ||
      !audit.fluid.decode_passed || audit.fluid.fps !== 60 ||
      audit.fluid.decoded_frames !== shot.output_frames ||
      Math.abs(audit.fluid.audio_alignment.measured_audio_lag_seconds) > .02) {
    throw new Error(`Unverified shot ${shot.id}`);
  }
  // Trim only already silent excess, retaining measured speech and the 250 ms pause.
  const frames = Math.ceil(shot.audio_seconds * 60);
  const seconds = frames / 60;
  if (frames > shot.output_frames) throw new Error(`Insufficient genuine video coverage: ${shot.id}`);
  const words = resolveWordTimings({ narration_text: shot.text, audio_duration_seconds: shot.audio_seconds,
    word_boundaries: shot.word_boundaries });
  if (words.some(w => w.end_seconds > seconds - .15)) throw new Error(`Word clipped: ${shot.id}`);
  // Native boundaries omit punctuation. Restore only matching narration tokens;
  // retain their timestamps and prevent a subtitle group spanning a sentence pause.
  const tokens = shot.text.trim().split(/\s+/);
  if (tokens.length !== words.length || words.some((word, i) => word.word.localeCompare(
      tokens[i]!.replace(/[,.;:!?]+$/, ""), "pt-BR", { sensitivity: "base" }) !== 0)) {
    throw new Error(`Narration/boundary word mismatch: ${shot.id}`);
  }
  const sentences: Array<typeof words> = [];
  let sentence: typeof words = [];
  for (const [i, word] of words.entries()) {
    sentence.push({ ...word, word: tokens[i]! });
    if (/[.!?]$/.test(tokens[i]!)) { sentences.push(sentence); sentence = []; }
  }
  if (sentence.length) sentences.push(sentence);
  const subtitle = join(assembled, `${shot.id}.ass`);
  await writeFile(subtitle, buildAssSubtitles(sentences.map(words => ({ words, scene_start_seconds: 0,
    highlight_words: ["biscoito", "boca", "presente", "fechado"], subtitle_position: "bottom_center" as const })),
    { ...SUBTITLE_STYLE_PORTRAIT, play_res_x: 704, play_res_y: 1280, font_size: 46, outline_px: 2, margin_v: 180 }));
  const escaped = escapeFfmpegFilterPath(subtitle);
  const path = join(assembled, `${shot.id}.mp4`);
  command("ffmpeg", ["-v", "error", "-y", "-i", clip, "-i", resolve(root, shot.audio),
    "-filter_complex", `[0:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,ass='${escaped}'[v];[1:a]apad,atrim=end=${seconds},asetpts=PTS-STARTPTS[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ar", "16000", "-movflags", "+faststart", path]);
  paths.push(path);
  cuts.push({ id: shot.id, speaker: shot.speaker, start_seconds: cursor, seconds, frames });
  cursor += seconds;
}
if (availableOnly && paths.length < plan.shots.length) {
  await writeFile(join(out, "assembly-progress.json"), JSON.stringify({ assembled: cuts, final_created: false }, null, 2));
  process.stdout.write(`${paths.length}/${plan.shots.length} available takes assembled; full scene awaits remaining clips.\n`);
  process.exit(0);
}
if (cursor < 15 || cursor > 20) throw new Error("Artistic preview outside requested duration");
// Explicit durations control each video packet timeline independently of AAC padding.
await writeFile(join(assembled, "concat.txt"), paths.map((path, i) =>
  buildConcatList([path]) + `duration ${cuts[i]!.seconds.toFixed(6)}\n`).join(""));
const final = join(out, "malu-laranjito-conversa.mp4");
// Video packet copy avoids another lossy encode. Rebuild audio from original PCM,
// not intermediate AAC, and align it to the exact measured cut durations.
const args = plan.shots.flatMap(shot => ["-i", resolve(root, shot.audio)]);
const graph = paths.map((_, i) => `[${i + 1}:a]apad,atrim=end=${cuts[i]!.seconds},asetpts=PTS-STARTPTS[a${i}]`).join(";") + ";" +
  paths.map((_, i) => `[a${i}]`).join("") + `concat=n=${paths.length}:v=0:a=1[rawa];` +
  "[rawa]loudnorm=I=-16:TP=-1.8:LRA=11,aresample=16000[a]";
// The unused AAC stream in the video concat has a negative encoder-priming timestamp.
// Keep original video PTS instead of letting FFmpeg offset it by that stream start.
command("ffmpeg", ["-v", "error", "-y", "-copyts", "-f", "concat", "-safe", "0", "-i", join(assembled, "concat.txt"),
  ...args, "-filter_complex", graph, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
  "-ar", "16000", "-avoid_negative_ts", "disabled", "-movflags", "+faststart", final]);
command("ffmpeg", ["-v", "error", "-i", final, "-f", "null", "-"]);
await writeFile(join(out, "assembly.json"), JSON.stringify({ title: plan.title, cuts, seconds: cursor,
  expected_frames: cuts.reduce((sum, cut) => sum + cut.frames, 0), fps: 60,
  sha256: hash(await readFile(final)), filename: "malu-laranjito-conversa.mp4", music: false,
  master_loudness_target_lufs: -16, master_true_peak_target_dbfs: -1.8, synthetic_fiction: true,
  master_video_packet_copy: true, master_audio_from_original_pcm: true,
  source_video_timestamps_preserved: true, aac_bitrate_requested: 96000,
  no_loop_no_speed_change: true, no_interpolation_across_cuts: true,
  subtitle_source: "original TTS word boundaries, matching narration punctuation, core ASS helper", published: false,
  database_writes: false, production_enabled: false, lip_sync_validated: false,
  human_review_required: true, mode: "artistic_preview_not_episode" }, null, 2));
process.stdout.write(`Assembled ${cursor.toFixed(3)}s at 60fps: ${final}\n`);
