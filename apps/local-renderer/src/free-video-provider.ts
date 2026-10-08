import { z } from "zod";
import { spawnSync } from "node:child_process";
import type { VideoProvider, VideoShot } from "../../../packages/core/src/stories/video-routing.ts";

// Reviewed public ZeroGPU API; changing the app/model requires a new visual audition.
export const HF_VIDEO = {
  id: "hf-wan-i2v", space: "zerogpu-aoti/wan2-2-fp8da-aoti-faster",
  host: "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space",
  revision: "1ff7432a88d7827eb787ef10c15cbc5c85c841a2",
  endpoint: "generate_video",
  hardware: "zero-a10g", kinds: ["action", "reaction"], mode: "i2v",
} as const;
/** Official public distilled S2V demo, sponsored by its owner; no purchased API key. */
export const HF_SPEECH = {
  id: "hf-wan-s2v", space: "Wan-AI/Wan2.2-S2V",
  host: "https://wan-ai-wan2-2-s2v.hf.space",
  revision: "ac7d98aa77112e77b3296ae5e52617d101a9883a", endpoint: "predict",
  hardware: "cpu-basic", kinds: ["dialogue"], mode: "s2v",
} as const;
/** Reviewed community MuseTalk 1.5 demo. Mouth inpainting, not body/scene generation. */
export const HF_LIPSYNC = {
  id: "hf-musetalk", space: "henrybit/musetalk-1-5",
  host: "https://henrybit-musetalk-1-5.hf.space",
  revision: "1bd58b7748557839bb585cb8ab6dd1399b80fcf9", endpoint: "generate",
  hardware: "zero-a10g", kinds: ["dialogue"], mode: "lipsync",
} as const;
/** Apache-2.0 Lite model on a public ZeroGPU Space. Dialogue close-ups only. */
export const HF_FLASHHEAD = {
  id: "hf-flashhead-lite", space: "khuong2532002/soulx-flashhead-demo",
  host: "https://khuong2532002-soulx-flashhead-demo.hf.space",
  revision: "ab40513381b0d68a4dfc2dc23b5ee667edd068ec", endpoint: "run_inference_streaming",
  hardware: "zero-a10g", kinds: ["dialogue"], mode: "flashhead",
} as const;
export type FreeVideoProfile = typeof HF_VIDEO | typeof HF_SPEECH | typeof HF_LIPSYNC | typeof HF_FLASHHEAD;
export function freeVideoQuotaLedger(profile: FreeVideoProfile): string {
  return profile.mode === "s2v" ? "speech-quota.json" : "quota.json";
}
export type VideoFetch = typeof fetch;
type VideoErrorCode = "access_required" | "quota_rejected" | "unavailable" | "contract_changed" | "unknown" | "generation_failed";
export class FreeVideoError extends Error {
  readonly code: VideoErrorCode;
  constructor(code: VideoErrorCode) {
    super(code); this.name = "FreeVideoError"; this.code = code;
  }
}
export function inspectSpaceMetadata(value: unknown, profile: FreeVideoProfile = HF_VIDEO): VideoProvider {
  const parsed = z.object({ sha: z.literal(profile.revision), host: z.literal(profile.host),
    runtime: z.object({ stage: z.literal("RUNNING"), hardware: z.object({ current: z.literal(profile.hardware) }) }),
  }).safeParse(value);
  return { id: profile.id, quota_group: profile.mode === "s2v" ? "wan-sponsored-demo" : "huggingface-account", capabilities: [...profile.kinds],
    quality: ["preview"], short_edge: profile.mode === "flashhead" ? 512 : 480,
    output_fps: profile.mode === "lipsync" || profile.mode === "flashhead" ? 25 : 16, max_seconds: 5,
    available: parsed.success, adapter_ready: true, checked_at: Date.now(), cooldown_until: 0,
    // Sponsored public S2V has no verified recurring allowance; a live endpoint is not proof.
    free_tier: profile.mode === "s2v" ? "unknown" : "recurring",
    free_remaining: null, billing: "free_service", reserved: 0, required: 1, cash_cost: 0 };
}
const params = ["input_image", "prompt", "steps", "negative_prompt", "duration_seconds", "guidance_scale", "guidance_scale_2", "seed", "randomize_seed"];
export function assertEndpoint(info: unknown, profile: FreeVideoProfile = HF_VIDEO): void {
  const endpoint = (info as { named_endpoints?: Record<string, { parameters?: Array<{ parameter_name?: string }>; api_visibility?: string }> })?.named_endpoints?.[`/${profile.endpoint}`];
  const visibilityValid = endpoint?.api_visibility === "public" || (profile.mode !== "i2v" && endpoint?.api_visibility == null);
  const expected = profile.mode === "i2v" ? params : profile.mode === "s2v" ? ["ref_img", "audio", "resolution"] :
    profile.mode === "flashhead" ? ["ckpt_dir", "wav2vec_dir", "model_type", "cond_image", "audio_path", "seed", "use_face_crop"] :
    ["audio_path", "video_path", "bbox_shift", "extra_margin", "parsing_mode", "left_cheek_width", "right_cheek_width"];
  if (!visibilityValid || endpoint?.parameters?.map(p => p.parameter_name).join() !== expected.join())
    throw new FreeVideoError("contract_changed");
}
function assertStatus(res: Response, submitting = false): void {
  if (res.ok) return;
  if ([401, 403].includes(res.status)) throw new FreeVideoError("access_required");
  if (res.status === 429) throw new FreeVideoError("quota_rejected");
  throw new FreeVideoError(submitting ? "unknown" : "unavailable");
}
export function assertOutputUrl(value: string, profile: FreeVideoProfile = HF_VIDEO): string {
  const url = new URL(value);
  const stream = profile.mode === "flashhead" &&
    /^\/gradio_api\/stream\/[a-f0-9]{32}\/[0-9]+\/[0-9]+\/playlist\.m3u8$/.test(url.pathname);
  if (url.origin !== profile.host || url.username || url.password || url.search || url.hash ||
    (!url.pathname.startsWith("/gradio_api/file=") && !stream)) throw new FreeVideoError("contract_changed");
  return url.toString();
}
/** SSE can split a UTF-8 character, data line or event across arbitrary packets. */
export async function readVideoEvent(body: ReadableStream<Uint8Array>, profile: FreeVideoProfile = HF_VIDEO, timeoutMs = 900_000): Promise<string> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900_000) throw new FreeVideoError("contract_changed");
  const reader = body.getReader(), decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FreeVideoError("unknown")), timeoutMs); });
  let buffer = "", total = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) throw new FreeVideoError("unknown");
      total += value.length;
      if (total > 2_000_000) throw new FreeVideoError("contract_changed");
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll("\r\n", "\n");
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = block.split("\n").find(l => l.startsWith("event:"))?.slice(6).trim();
        const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (event === "error") {
          // Never persist/print upstream errors: they may include submitted prompts or server secrets.
          if (/quota|exceeded|too many/i.test(data)) throw new FreeVideoError("quota_rejected");
          if (/sign.?in|log.?in|authenticate|token/i.test(data)) throw new FreeVideoError("access_required");
          throw new FreeVideoError("generation_failed");
        }
        if (event === "complete") {
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { throw new FreeVideoError("contract_changed"); }
          const payload = profile.mode === "i2v"
            ? z.tuple([z.object({ url: z.string() }), z.number()]).safeParse(parsed)
            : profile.mode === "s2v" || profile.mode === "flashhead"
              ? z.tuple([z.object({ video: z.object({ url: z.string() }) })]).safeParse(parsed)
              : z.tuple([z.object({ video: z.object({ url: z.string() }) }), z.string()]).safeParse(parsed);
          if (!payload.success) throw new FreeVideoError("contract_changed");
          const file = payload.data[0];
          return assertOutputUrl("video" in file ? file.video.url : file.url, profile);
        }
      }
    }
  } finally {
    clearTimeout(timer!);
    // A stalled upstream cancel must not keep the operator client alive indefinitely.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export class FreeVideoProvider {
  private readonly http: VideoFetch;
  private readonly headers: Record<string, string>;
  readonly profile: FreeVideoProfile;
  constructor(token?: string, http: VideoFetch = fetch, profile: FreeVideoProfile = HF_VIDEO) {
    this.profile = profile;
    this.http = http;
    this.headers = token ? { Authorization: `Bearer ${token}` } : {};
  }
  async inspect(): Promise<VideoProvider> {
    const res = await this.http(`https://huggingface.co/api/spaces/${this.profile.space}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    assertStatus(res);
    const metadata = inspectSpaceMetadata(await res.json(), this.profile);
    if (!metadata.available) return metadata;
    const info = await this.http(`${this.profile.host}/gradio_api/info`, { headers: this.headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    assertStatus(info); assertEndpoint(await info.json(), this.profile);
    return metadata;
  }
  async upload(image: Uint8Array, audio?: Uint8Array): Promise<string[]> {
    const body = new FormData(); body.append("files", new Blob([new Uint8Array(image)], { type: "image/png" }), "reference.png");
    if (audio) body.append("files", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "voice.wav");
    const res = await this.http(`${this.profile.host}/gradio_api/upload`, { method: "POST", headers: this.headers, body, redirect: "error", signal: AbortSignal.timeout(60_000) });
    assertStatus(res);
    return z.array(z.string().startsWith("/tmp/gradio/").max(1024)).length(audio ? 2 : 1).parse(await res.json());
  }
  async submit(shot: VideoShot, uploaded: string[]): Promise<string> {
    const file = (path: string) => ({ path, meta: { _type: "gradio.FileData" } });
    const data = this.profile.mode === "i2v" ? [file(uploaded[0]!), shot.prompt, 6,
      "deformed hands, extra fingers, missing fingers, distorted face, changing clothes, morphing objects, text, subtitles, watermark, speaking, lip movement",
      shot.seconds, 1, 1, shot.seed, false] : this.profile.mode === "s2v" ? [file(uploaded[0]!), file(uploaded[1]!), "480P"] :
      this.profile.mode === "flashhead" ? ["models/SoulX-FlashHead-1_3B", "models/wav2vec2-base-960h", "lite",
        file(uploaded[0]!), file(uploaded[1]!), shot.seed, false] :
      [file(uploaded[1]!), file(uploaded[0]!), 0, 10, "jaw", 90, 90];
    if (uploaded.length !== (this.profile.mode !== "i2v" ? 2 : 1) ||
      (this.profile.mode !== "i2v") !== (shot.kind === "dialogue")) throw new FreeVideoError("contract_changed");
    const res = await this.http(`${this.profile.host}/gradio_api/call/${this.profile.endpoint}`, {
      method: "POST", headers: { ...this.headers, "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ data }),
    });
    assertStatus(res, true);
    return z.object({ event_id: z.string().regex(/^[a-f0-9]{32}$/) }).parse(await res.json()).event_id;
  }
  async wait(eventId: string, timeoutMs = 900_000): Promise<string> {
    if (!/^[a-f0-9]{32}$/.test(eventId)) throw new FreeVideoError("contract_changed");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900_000) throw new FreeVideoError("contract_changed");
    const expires = Date.now() + timeoutMs;
    const res = await this.http(`${this.profile.host}/gradio_api/call/${this.profile.endpoint}/${eventId}`, {
      headers: this.headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    });
    assertStatus(res);
    if (!res.body) throw new FreeVideoError("unknown");
    return readVideoEvent(res.body, this.profile, Math.max(1, expires - Date.now()));
  }
  async download(url: string): Promise<Uint8Array> {
    const validated = assertOutputUrl(url, this.profile);
    if (this.profile.mode === "flashhead" && validated.endsWith("/playlist.m3u8")) return this.downloadHls(validated);
    const output = await this.readBounded(validated, 64 * 1024 * 1024);
    if (output.length < 12 || new TextDecoder().decode(output.slice(4, 8)) !== "ftyp") throw new FreeVideoError("contract_changed");
    return output;
  }
  private async readBounded(url: string, limit: number): Promise<Uint8Array> {
    const res = await this.http(url, { headers: this.headers, redirect: "error", signal: AbortSignal.timeout(120_000) });
    assertStatus(res);
    if (!res.body || Number(res.headers.get("content-length")) > limit) throw new FreeVideoError("contract_changed");
    const reader = res.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > limit) throw new FreeVideoError("contract_changed");
        parts.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const output = new Uint8Array(size); let cursor = 0;
    for (const part of parts) { output.set(part, cursor); cursor += part.length; }
    return output;
  }
  private async downloadHls(playlistUrl: string): Promise<Uint8Array> {
    const playlistBytes = await this.readBounded(playlistUrl, 32 * 1024);
    const playlist = new TextDecoder("utf-8", { fatal: true }).decode(playlistBytes);
    const lines = playlist.split(/\r?\n/).filter(Boolean);
    if (lines[0] !== "#EXTM3U" || lines.at(-1) !== "#EXT-X-ENDLIST") throw new FreeVideoError("unknown");
    const names = lines.filter(line => !line.startsWith("#"));
    if (names.length < 1 || names.length > 32 || names.some(name => !/^[a-f0-9-]{36}\.ts$/.test(name)))
      throw new FreeVideoError("contract_changed");
    const chunks: Uint8Array[] = []; let total = 0;
    for (const name of names) {
      const segment = new URL(name, playlistUrl);
      if (segment.origin !== this.profile.host || !segment.pathname.startsWith(new URL(playlistUrl).pathname.replace(/playlist\.m3u8$/, "")) ||
        segment.search || segment.hash) throw new FreeVideoError("contract_changed");
      const bytes = await this.readBounded(segment.toString(), 20 * 1024 * 1024);
      total += bytes.length;
      if (bytes.length === 0 || total > 64 * 1024 * 1024) throw new FreeVideoError("contract_changed");
      chunks.push(bytes);
    }
    // Gradio serves MPEG-TS fragments. Remux only local, validated bytes; FFmpeg never receives a remote URL or token.
    const remux = spawnSync("ffmpeg", ["-v", "error", "-f", "mpegts", "-i", "pipe:0", "-c", "copy", "-bsf:a", "aac_adtstoasc",
      "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"],
      { input: Buffer.concat(chunks), maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    if (remux.status !== 0 || remux.stdout.length < 12 || remux.stdout.subarray(4, 8).toString() !== "ftyp")
      throw new FreeVideoError("contract_changed");
    return remux.stdout;
  }
}
