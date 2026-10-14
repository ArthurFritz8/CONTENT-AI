import { spawnSync } from "node:child_process";
import { AurayError } from "./auray-video-provider.ts";

export async function verifyAurayMedia(path: string, shot: { kind: string; aspect_ratio: "9:16" | "16:9"; native_dialogue?: { text: string; language: string } }) {
  const probe = spawnSync("ffprobe",["-v","error","-count_frames","-show_streams","-show_format","-of","json",path],{ encoding: "utf8",timeout: 30_000,windowsHide: true });
  if (probe.status !== 0) throw new AurayError("media_probe_failed");
  const media = JSON.parse(probe.stdout), videos = media.streams?.filter((s: { codec_type: string }) => s.codec_type === "video");
  if (videos?.length !== 1) throw new AurayError("media_invalid");
  const v = videos[0], duration = Number(v.duration ?? media.format?.duration), [num,den] = String(v.avg_frame_rate).split("/").map(Number);
  const fps = Number(num) / Number(den), frames = Number(v.nb_read_frames), width = Number(v.width), height = Number(v.height);
  if (![duration,fps,frames,width,height].every(n => Number.isFinite(n) && n > 0) || duration < 4.8 || duration > 5.2 ||
      Math.abs(width/height - (shot.aspect_ratio === "9:16" ? 9/16 : 16/9)) > .025) throw new AurayError("media_invalid");
  const decode = spawnSync("ffmpeg",["-v","error","-i",path,"-f","null","-"],{ encoding: "utf8",timeout: 30_000,windowsHide: true });
  if (decode.status !== 0) throw new AurayError("media_decode_failed");
  const hasAudio = Boolean(media.streams?.some((s: { codec_type: string }) => s.codec_type === "audio"));
  if (shot.kind === "native_dialogue_probe" && !hasAudio) throw new AurayError("native_dialogue_missing_audio");
  return { seconds: duration, width,height, encoded_fps: fps, decoded_frames: frames,
    has_audio: hasAudio,dialogue_requested:shot.kind === "native_dialogue_probe",
    ...(shot.native_dialogue ? { expected_speech:shot.native_dialogue.text,requested_language:shot.native_dialogue.language,
      voice_source:"provider_generated_unverified",voice_identity_approved:false,speech_transcription_verified:false,lip_sync_review_pending:true } : {}),
    native_motion_fps: null, dialogue_approved: false, continuity_approved: false, editorial_status: "review_pending",
    note: "Arquivo original. FPS codificado não comprova fluidez, poses novas, anatomia ou identidade. Prévia isolada; não entra na novela." };
}
