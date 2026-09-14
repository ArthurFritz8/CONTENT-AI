import { FPS, ORIENTATIONS, type Orientation } from "./render-utils.ts";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  duration?: string;
}

export interface MediaProbe {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string };
}

// Container/AAC rounding is expected; a missing scene or audio track is not.
export const MEDIA_DURATION_TOLERANCE_SECONDS = 0.25;

export function assessMedia(probe: MediaProbe, orientation: Orientation, expectedDuration: number, editorialDuration: number) {
  const videos = probe.streams?.filter(s => s.codec_type === "video") ?? [];
  const audios = probe.streams?.filter(s => s.codec_type === "audio") ?? [];
  const video = videos[0];
  const audio = audios[0];
  const size = ORIENTATIONS[orientation];
  const duration = Number(probe.format?.duration);
  const bytes = Number(probe.format?.size);
  const [num, den] = (video?.avg_frame_rate ?? "").split("/").map(Number);
  const fps = Number(num) / Number(den);
  const problems: string[] = [];
  if (videos.length !== 1 || video?.codec_name !== "h264" || video.pix_fmt !== "yuv420p") problems.push("vídeo deve conter uma faixa H.264 yuv420p");
  if (video?.width !== size.width || video?.height !== size.height) problems.push("resolução incorreta");
  // AAC padding changes average timestamps slightly when concatenating scenes.
  // The concatenation fixture reports r_frame_rate=240 despite ~30 presented FPS.
  if (!Number.isFinite(fps) || Math.abs(fps - FPS) > FPS * 0.01) problems.push(`taxa de quadros incorreta (média ${fps})`);
  if (audios.length !== 1 || audio?.codec_name !== "aac") problems.push("áudio deve conter uma faixa AAC");
  if (!Number.isFinite(bytes) || bytes <= 0) problems.push("arquivo vazio ou tamanho inválido");
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(expectedDuration) || expectedDuration <= 0 ||
    Math.abs(duration - expectedDuration) > MEDIA_DURATION_TOLERANCE_SECONDS) problems.push("duração final diverge da soma das cenas");
  for (const [name, stream] of [["vídeo", video], ["áudio", audio]] as const) {
    const streamDuration = Number(stream?.duration);
    if (!Number.isFinite(streamDuration) || streamDuration <= 0 || Math.abs(streamDuration - duration) > MEDIA_DURATION_TOLERANCE_SECONDS) problems.push(`duração da faixa de ${name} inválida ou incompleta`);
  }
  if (problems.length) throw new Error(`QA audiovisual (${orientation}): ${problems.join("; ")}`);
  return {
    version: "1.0.0", orientation, duration_seconds: duration, size_bytes: bytes,
    width: size.width, height: size.height, fps, video_codec: "h264", audio_codec: "aac",
    expected_duration_seconds: expectedDuration, editorial_duration_seconds: editorialDuration,
    warnings: Number.isFinite(editorialDuration) && editorialDuration > 0 && Math.abs(duration - editorialDuration) / editorialDuration > 0.2
      ? ["A duração real diverge mais de 20% do alvo editorial; revisar ritmo e quantidade de narração."] : [],
  };
}

export function assertMatchingDurations(landscape: number, portrait: number): void {
  if (!Number.isFinite(landscape) || !Number.isFinite(portrait) || Math.abs(landscape - portrait) > MEDIA_DURATION_TOLERANCE_SECONDS) {
    throw new Error("QA audiovisual: durações horizontal e vertical divergem");
  }
}
