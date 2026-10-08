/** Local continuity preview from verified existing media. No cloud, DB or publishing. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildAssSubtitles, resolveWordTimings, SUBTITLE_STYLE_PORTRAIT } from "@content-ai/core";
import { buildConcatList, escapeFfmpegFilterPath } from "../apps/local-renderer/src/render-utils.ts";

const root = resolve(import.meta.dirname, "..");
const enhanced = process.argv.includes("--flashhead-enhanced");
const freeDialogue = enhanced || process.argv.includes("--flashhead");
if (process.argv.slice(2).length > 1 || process.argv.slice(2).some(arg => !["--flashhead", "--flashhead-enhanced"].includes(arg)))
  throw new Error("Opções permitidas: --flashhead ou --flashhead-enhanced");
const out = join(root, enhanced ? "output/free-story-sequence-flashhead-enhanced" :
  freeDialogue ? "output/free-story-sequence-flashhead" : "output/free-story-sequence");
await mkdir(out, { recursive: true });
const reactionDir = join(root, "output/free-video-jobs/44966b220d5b6d2b2a44b6038d87067b2aba56f9d47e4f34ef40e87cca57bc34");
const dialogueDir = join(root, "output/suitcase-story-preview/02");
const flashheadDir = join(root, "output/provider-research-deep-2026-10-08/flashhead-audition-2");
const reaction = join(reactionDir, "clip.mp4");
const dialogue = freeDialogue ? join(flashheadDir, "normalized.mp4") : join(dialogueDir, "fluid.mp4");
const voice = join(dialogueDir, "voice.wav");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const reactionQA = JSON.parse(await readFile(join(reactionDir, "qa.json"), "utf8"));
const dialogueQA = freeDialogue ? null : JSON.parse(await readFile(join(dialogueDir, "av-audit.json"), "utf8"));
const story = JSON.parse(await readFile(join(root, "output/suitcase-story-preview/plan.json"), "utf8"));
const line = story.shots.find((s: { id: string }) => s.id === "02");
if (!line || !reactionQA.decode_verified || (!freeDialogue && !dialogueQA?.fluid.decode_passed) ||
  hash(await readFile(reaction)) !== reactionQA.sha256 ||
  hash(await readFile(dialogue)) !== (freeDialogue ? "829cc86fa83f6974841b54d696c1ed3f63f3623947078f7534baa85447e3161f" : dialogueQA.fluid.sha256) ||
  hash(await readFile(voice)) !== line.audio_sha256 || line.audio_seconds !== 3.25)
  throw new Error("Verified reference, voice and source checkpoints required");
function command(name: string, args: string[]): string {
  const result = spawnSync(name, args, { encoding: "utf8", timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}`);
  return result.stdout;
}
if (freeDialogue) {
  const media = JSON.parse(command("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", dialogue]));
  const track = media.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  if (track?.width !== 512 || track?.height !== 512 || track?.avg_frame_rate !== "25/1" || Number(track?.nb_read_frames) !== 82)
    throw new Error("FlashHead source coverage changed");
  command("python", ["-X", "utf8", join(root, "scripts/audit-free-story-dialogue.py"), dialogue, voice]);
}
if (process.platform === "win32") {
  const fonts = join(out, "fonts.conf");
  await writeFile(fonts, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>C:/Windows/Fonts</dir><cachedir>${out.replaceAll("\\", "/")}/fontcache</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE = fonts;
}
const fps = 60;
const cuts = [
  { id: "01", source: reaction, start: 0, end: .5, frames: 30, kind: "action", voice: false },
  { id: "02", source: dialogue, start: 0, end: 3.25, frames: 195, kind: "dialogue", voice: true },
  { id: "03", source: reaction, start: .5, end: 3.5625, frames: 184, kind: "reaction", voice: false },
];
const words = resolveWordTimings({ narration_text: line.text, audio_duration_seconds: line.audio_seconds,
  word_boundaries: line.word_boundaries });
const tokens = String(line.text).trim().split(/\s+/);
if (tokens.length !== words.length || words.some((w, i) => w.word.localeCompare(tokens[i]!.replace(/[,.;:!?]+$/, ""), "pt-BR", { sensitivity: "base" }) !== 0))
  throw new Error("Narration and word boundaries mismatch");
const sentences: Array<typeof words> = []; let sentence: typeof words = [];
words.forEach((word, i) => {
  sentence.push({ ...word, word: tokens[i]! });
  if (/[.!?]$/.test(tokens[i]!)) { sentences.push(sentence); sentence = []; }
});
if (sentence.length) sentences.push(sentence);
const subtitles = join(out, "dialogue.ass");
await writeFile(subtitles, buildAssSubtitles(sentences.map(words => ({ words, scene_start_seconds: 0,
  highlight_words: ["malas", "embora"], subtitle_position: "bottom_center" as const })),
  { ...SUBTITLE_STYLE_PORTRAIT, play_res_x: 480, play_res_y: 832, font_size: 31, outline_px: 2, margin_v: 98 }));
const paths: string[] = []; let cursor = 0;
const timeline: Array<Record<string, unknown>> = [];
for (const cut of cuts) {
  const seconds = cut.frames / fps, target = join(out, `${cut.id}.mp4`);
  const audioArgs = cut.voice ? ["-i", voice] : ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"];
  const subtitlesFilter = cut.voice ? `,ass='${escapeFfmpegFilterPath(subtitles)}'` : "";
  // Motion interpolation omits the last source interval; pad only its tail to preserve the verified cut length.
  const motion = enhanced ? "tpad=stop_mode=clone:stop_duration=0.125,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1," : "";
  const videoGraph = enhanced && cut.voice
    ? `[0:v]${motion}trim=start=${cut.start}:end=${cut.end},setpts=PTS-STARTPTS,split[bg][fg];` +
      `[bg]scale=480:832:force_original_aspect_ratio=increase,crop=480:832,boxblur=30:2[bb];` +
      `[fg]scale=672:672:flags=lanczos,crop=480:672,unsharp=5:5:0.4[ff];` +
      `[bb][ff]overlay=0:80,trim=end_frame=${cut.frames}${subtitlesFilter}[v]`
    : `[0:v]${motion}trim=start=${cut.start}:end=${cut.end},setpts=PTS-STARTPTS,` +
    `scale=480:832:force_original_aspect_ratio=increase,crop=480:832,setsar=1,fps=${fps},trim=end_frame=${cut.frames}` +
    subtitlesFilter + "[v]";
  command("ffmpeg", ["-v", "error", "-y", "-i", cut.source, ...audioArgs, "-filter_complex",
    `${videoGraph};[1:a]atrim=end=${seconds},asetpts=PTS-STARTPTS[a]`, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-ar", "16000",
    "-movflags", "+faststart", target]);
  const probe = JSON.parse(command("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", target]));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  if (Number(video?.nb_read_frames) !== cut.frames) throw new Error(`Missing video coverage: ${cut.id}`);
  paths.push(target);
  timeline.push({ id: cut.id, function: cut.kind, start_seconds: cursor, seconds, source_start: cut.start, source_end: cut.end,
    source_sha256: hash(await readFile(cut.source)), dialogue_from_existing_modal_take: cut.voice && !freeDialogue,
    dialogue_from_free_flashhead: cut.voice && freeDialogue,
    source_encoded_fps: cut.voice ? (freeDialogue ? 25 : 60) : 16,
    interpolation: enhanced ? "ffmpeg_motion_compensated" :
      cut.voice && !freeDialogue ? "source_60fps" : "frame_duplication_to_60fps",
    visual_restoration: enhanced && cut.voice ? "less_crop_and_mild_sharpen_not_eye_reconstruction" : "none",
    new_body_frames_generated: false });
  cursor += seconds;
}
const list = join(out, "concat.txt");
await writeFile(list, paths.map((path, i) => buildConcatList([path]) + `duration ${(cuts[i]!.frames / fps).toFixed(6)}\n`).join(""));
const final = join(out, enhanced ? "a-mala-acao-fala-reacao-flashhead-enhanced.mp4" :
  freeDialogue ? "a-mala-acao-fala-reacao-flashhead.mp4" : "a-mala-acao-fala-reacao.mp4");
const dialogueOffset = cuts[0]!.frames / fps;
// Original PCM placed at the exact dialogue cut; AAC intermediate tracks are not reused.
command("ffmpeg", ["-v", "error", "-y", "-copyts", "-f", "concat", "-safe", "0", "-i", list, "-i", voice,
  "-filter_complex", `[1:a]adelay=${Math.round(dialogueOffset * 1000)}:all=1,apad,atrim=end=${cursor},asetpts=PTS-STARTPTS[a]`,
  "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-ar", "16000",
  "-avoid_negative_ts", "disabled", "-movflags", "+faststart", final]);
command("ffmpeg", ["-v", "error", "-xerror", "-i", final, "-f", "null", "-"]);
const info = JSON.parse(command("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", final]));
const video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
if (Number(video.nb_read_frames) !== 409 || video.width !== 480 || video.height !== 832 || Math.abs(Number(video.duration) - cursor) > .001)
  throw new Error("Final timeline differs from verified cuts");
const extracted = join(out, "dialogue-transport.mkv");
command("ffmpeg", ["-v", "error", "-y", "-i", final, "-ss", String(dialogueOffset), "-t", "3.25", "-c:v", "libx264", "-c:a", "pcm_s16le", "-f", "matroska", extracted]);
const audioAlignment = JSON.parse(command("python", ["-X", "utf8", join(root, "scripts/audit-free-story-dialogue.py"), extracted, voice]));
await writeFile(join(out, "qa.json"), JSON.stringify({ title: "A mala na porta — ação, fala e reação", seconds: cursor,
  width: video.width, height: video.height, encoded_fps: fps, frames: 409, cuts: timeline,
  sha256: hash(await readFile(final)), decode_verified: true, audio_alignment: audioAlignment,
  zero_new_cloud_calls: true, cash_charge_usd: 0, reused_modal_dialogue: !freeDialogue,
  dialogue_from_free_flashhead: freeDialogue,
  local_enhancement_experiment: enhanced, blurry_source_eyes_restored: false,
  new_free_lipsync_validated: false, fps_conversion_duplicates_frames: !enhanced,
  fps_conversion_estimates_intermediate_frames: enhanced, interpolation_tail_padding: enhanced,
  body_source_native_fps_from_model: 16, head_and_body_acting_not_invented_by_fps_conversion: true,
  human_review_required: true, lip_sync_certified: false, production_enabled: false,
  database_writes: false, published: false, mode: "artistic_preview_not_episode" }, null, 2));
process.stdout.write(JSON.stringify({ event: "sequence_ready", path: final, seconds: cursor, new_cloud_calls: 0, human_review_required: true }) + "\n");
