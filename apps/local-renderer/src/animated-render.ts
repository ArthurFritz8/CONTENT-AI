import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scriptJsonSchema, type ScriptJson } from "../../../packages/core/src/schemas/script-json.ts";
import { ANIMATED_SHOT_SECONDS } from "../../../packages/core/src/stories/animation-contract.ts";
import { escapeFfmpegFilterPath } from "./render-utils.ts";
import { buildAssSubtitles, type SceneSubtitleInput } from "../../../packages/core/src/subtitles/ass-builder.ts";
import { resolveWordTimings } from "../../../packages/core/src/subtitles/subtitle-timing.ts";

async function command(executable: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { errors = (errors + data).slice(-3000); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(Error(`${executable} falhou (${code}): ${errors}`)));
  });
}
const probe = async (path: string) => JSON.parse(await command("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path]));
export type AnimatedLocalTake = { path: string; sha256: string; audioPath: string; audio_sha256: string };

/** Exact clip/PCM identities are checked again at the CPU boundary. No motion loop or frozen padding. */
export async function renderAnimatedChapter(raw: ScriptJson, takes: AnimatedLocalTake[], directory: string) {
  const script = scriptJsonSchema.parse(raw), format = script.fiction?.animation;
  if (!format || takes.length !== script.scenes.length) throw Error("Montagem exige todas as tomadas do capítulo animado");
  const scenes = [...script.scenes].sort((a, b) => a.order - b.order), inputs: string[] = [], filters: string[] = [], subtitles: SceneSubtitleInput[] = [];
  for (const [i, scene] of scenes.entries()) {
    const take = takes[i]!, binding = scene.animation!;
    if (take.audio_sha256 !== binding.audio_sha256 ||
      createHash("sha256").update(await readFile(take.path)).digest("hex") !== take.sha256 ||
      createHash("sha256").update(await readFile(take.audioPath)).digest("hex") !== binding.audio_sha256)
      throw Error("Arquivo da tomada ou áudio foi alterado");
    const media = await probe(take.path), videos = media.streams.filter((s: { codec_type: string }) => s.codec_type === "video"), video = videos[0];
    if (videos.length !== 1 || video.width !== format.width || video.height !== format.height || video.codec_name !== "h264" ||
      video.pix_fmt !== "yuv420p" || video.avg_frame_rate !== "60/1" || Number(video.nb_read_frames) !== format.output_frames ||
      Math.abs(Number(video.duration) - ANIMATED_SHOT_SECONDS) > 0.001 || Number(video.start_time) !== 0)
      throw Error("Tomada não preserva o formato homologado");
    const audio = await probe(take.audioPath), streams = audio.streams;
    if (streams.length !== 1 || streams[0].codec_type !== "audio" || streams[0].codec_name !== "pcm_s16le" ||
      streams[0].sample_rate !== "16000" || streams[0].channels !== 1 ||
      Math.abs(Number(audio.format.duration) - binding.audio_seconds) > 1 / 16000)
      throw Error("Áudio de montagem diverge do PCM usado na sincronização");
    subtitles.push({ words: resolveWordTimings({ narration_text: scene.narration_text,
      audio_duration_seconds: binding.audio_seconds, word_boundaries: undefined }), scene_start_seconds: i * ANIMATED_SHOT_SECONDS,
      highlight_words: [], subtitle_position: "bottom_center" });
    inputs.push("-i", take.path, "-i", take.audioPath);
    filters.push(`[${2 * i}:v]settb=1/60,setpts=N[v${i}];[${2 * i + 1}:a]apad,atrim=duration=${ANIMATED_SHOT_SECONDS},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const subtitle = join(directory, "animated-chapter.ass"), output = join(directory, "animated-chapter.mp4");
  await writeFile(subtitle, buildAssSubtitles(subtitles, { play_res_x: format.width, play_res_y: format.height,
    font_name: "Arial", font_size: 36, margin_v: 180, words_per_group: 3, outline_px: 2 }));
  filters.push(scenes.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${scenes.length}:v=1:a=1[combined][a]`);
  // Single encoding pass, exact frame grid; original PCM avoids concatenated AAC padding/drift.
  filters.push(`[combined]settb=1/60,setpts=N,subtitles='${escapeFfmpegFilterPath(subtitle)}'[v]`);
  await command("ffmpeg", ["-y", "-v", "error", "-xerror", ...inputs, "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-fps_mode", "passthrough", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output]);
  const quality = await inspectAnimatedOutput(output, script);
  return { path: output, quality };
}

export async function inspectAnimatedOutput(path: string, script: ScriptJson) {
  const a = script.fiction?.animation;
  if (!a) throw Error("Perfil de animação ausente");
  const media = await probe(path), videos = media.streams.filter((s: { codec_type: string }) => s.codec_type === "video"),
    audios = media.streams.filter((s: { codec_type: string }) => s.codec_type === "audio"), v = videos[0], audio = audios[0],
    frames = script.scenes.length * a.output_frames, duration = frames / a.output_fps;
  if (videos.length !== 1 || audios.length !== 1 || v.width !== a.width || v.height !== a.height || v.codec_name !== "h264" ||
    v.pix_fmt !== "yuv420p" || v.avg_frame_rate !== "60/1" || Number(v.nb_read_frames) !== frames || audio.codec_name !== "aac" ||
    Math.abs(Number(v.duration) - duration) > 1 / 60 || Math.abs(Number(audio.duration) - duration) > 0.05 ||
    Number(media.format.size) <= 0 || Number(media.format.size) > 50 * 1024 * 1024)
    throw Error("Capítulo final perdeu quadros, duração, áudio ou qualidade contratada");
  await command("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
  return { version: "1.0.0", orientation: a.orientation, width: a.width, height: a.height, fps: a.output_fps,
    frame_count: frames, duration_seconds: duration, size_bytes: Number(media.format.size), decode_verified: true,
    profile_sha256: a.profile_sha256, human_review_required: true, lip_sync_validated: false };
}
