import type { MediaProbe } from "./media-quality.ts";
import { escapeFfmpegFilterPath, FPS, type Orientation, type SceneAssetLike } from "./render-utils.ts";

/** Only use the exact visual referenced by the current script, never an older clip by order. */
export function isSceneClip(assets: SceneAssetLike[], url: string, order: number, orientation: Orientation): boolean {
  const matches = assets.filter(asset => asset.url === url);
  const clips = matches.filter(asset => asset.type === "video_clip");
  if (!clips.length) return false;
  if (matches.some(asset => asset.type === "image") || clips.length !== 1 ||
    clips[0]!.metadata?.scene_order !== order || clips[0]!.metadata?.orientation !== orientation) {
    throw new Error(`Clipe da cena ${order} (${orientation}) com vínculo ambíguo ou inválido`);
  }
  return true;
}

export function assertClipCoverage(probe: MediaProbe, requiredSeconds: number): number {
  const videos = probe.streams?.filter(stream => stream.codec_type === "video") ?? [];
  const video = videos[0];
  // Container duration may include an audio tail; only measured video coverage counts.
  const duration = Number(video?.duration);
  if (videos.length !== 1 || !video?.width || !video.height || !Number.isFinite(duration) || duration <= 0 ||
    !Number.isFinite(requiredSeconds) || requiredSeconds <= 0) {
    throw new Error("Clipe exige uma faixa de vídeo com duração medida válida");
  }
  if (duration + 0.001 < requiredSeconds) {
    throw new Error(`Clipe tem ${duration.toFixed(3)}s; cena exige ${requiredSeconds.toFixed(3)}s. Gere uma tomada suficiente; repetição automática não é permitida.`);
  }
  return duration;
}

export function buildClipSceneFilterGraph(args: {
  size: { width: number; height: number };
  subtitlePath: string;
  audioDuration: number;
  gapSeconds: number;
}): string {
  const duration = args.audioDuration + args.gapSeconds;
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Duração da cena inválida");
  // Contain + pad preserves both characters when aspect ratios differ. No Ken Burns on moving footage.
  // One output frame of padding only compensates resampling at the tail after coverage was checked.
  return `[0:v]setpts=PTS-STARTPTS,fps=${FPS},` +
    `scale=${args.size.width}:${args.size.height}:force_original_aspect_ratio=decrease,` +
    `pad=${args.size.width}:${args.size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,` +
    `tpad=stop_mode=clone:stop_duration=${(1 / FPS).toFixed(6)},trim=duration=${duration.toFixed(3)},` +
    `subtitles='${escapeFfmpegFilterPath(args.subtitlePath)}'[v];` +
    `[1:a]apad=pad_dur=${args.gapSeconds.toFixed(3)},atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
}
