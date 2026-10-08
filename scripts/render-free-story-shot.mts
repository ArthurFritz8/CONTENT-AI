/** Isolated, bounded visual audition. No database, episode, publication or Modal calls. */
import { readFile, writeFile, mkdir, open, rename, appendFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalStringify, sha256Hex } from "../packages/core/src/validators/hash-utils.ts";
import { createHash } from "node:crypto";
import { routeVideoShot, videoShotSchema } from "../packages/core/src/stories/video-routing.ts";
import { FreeVideoError, FreeVideoProvider, HF_VIDEO, HF_SPEECH, HF_LIPSYNC, HF_FLASHHEAD, freeVideoQuotaLedger } from "../apps/local-renderer/src/free-video-provider.ts";

const root = resolve(import.meta.dirname, ".."), out = join(root, "output", "free-video-jobs");
const mode = process.argv[2];
const waitArg = process.argv.find(v => v.startsWith("--wait-seconds="));
const waitMs = waitArg ? Number(waitArg.split("=")[1]) * 1000 : 900_000;
if (!Number.isInteger(waitMs) || waitMs < 1000 || waitMs > 900_000) throw new Error("Espera deve ser de 1 a 900 segundos");
if (!["--inspect", "--run", "--resume"].includes(mode ?? "")) throw new Error("Use --inspect ou --run/--resume caminho-do-plano.json");
await mkdir(out, { recursive: true });
// Read only the requested provider key; never use global credential stores.
let token: string | undefined;
try {
  const env = await readFile(join(root, ".env.cloud"), "utf8");
  const value = env.split(/\r?\n/).find(l => /^HF_TOKEN\s*=/.test(l))?.split("=").slice(1).join("=").trim();
  token = value?.replace(/^(['"])(.*)\1$/, "$2") || undefined;
} catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
const report = (event: string, details: Record<string, unknown> = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  process.stdout.write(line + "\n"); return appendFile(join(out, "events.jsonl"), line + "\n");
};
async function save(path: string, value: unknown) {
  const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2) + "\n"); await rename(temp, path);
}
async function read<T>(path: string, missing: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return missing; throw e; }
}
if (mode === "--inspect") {
  for (const profile of [HF_VIDEO, HF_SPEECH, HF_LIPSYNC, HF_FLASHHEAD]) {
    try {
      const capacity = await new FreeVideoProvider(token, fetch, profile).inspect();
      await save(join(out, `${profile.id}-capacity.json`), capacity);
      await report("provider_checked", { ...capacity, authenticated: Boolean(token), remaining_generations: null,
        note: "Cota externa não exposta; não estimar vídeos. API gratuita experimental, sem certificação visual." });
    } catch (e) { await report("provider_unavailable", { provider: profile.id, code: e instanceof FreeVideoError ? e.code : "unknown" }); }
  }
  process.exit(0);
}
const path = process.argv[3]; if (!path) throw new Error("Plano da tomada obrigatório");
const shot = videoShotSchema.parse(JSON.parse(await readFile(resolve(path), "utf8")));
const providerArg = process.argv.find(v => v.startsWith("--provider="))?.split("=")[1];
if (providerArg && ![HF_LIPSYNC.id, HF_FLASHHEAD.id, HF_SPEECH.id].includes(providerArg))
  throw new Error("Provedor explícito não reconhecido");
if (providerArg === HF_SPEECH.id && mode === "--run")
  throw new Error("S2V patrocinado sem gratuidade recorrente comprovada; somente retomar chamadas existentes");
if (providerArg && shot.kind !== "dialogue") throw new Error("Este provedor só recebe diálogo; não gera atuação corporal");
// A previously accepted S2V call keeps its original fingerprint and can still be reconciled.
const { min_output_fps: legacyMinFps, ...legacyShot } = shot;
const legacyKey = mode === "--resume" && !providerArg && shot.kind === "dialogue"
  ? await sha256Hex(canonicalStringify({ shot: { ...legacyShot, min_native_fps: legacyMinFps },
      provider: { id: HF_SPEECH.id, space: HF_SPEECH.space, host: HF_SPEECH.host,
        revision: HF_SPEECH.revision, endpoint: HF_SPEECH.endpoint }, steps: 6, guidance: 1 })) : null;
const legacyState = legacyKey ? await read<{ status?: string } | null>(join(out, legacyKey, "state.json"), null) : null;
const profile = providerArg === HF_LIPSYNC.id ? HF_LIPSYNC : providerArg === HF_SPEECH.id || legacyState ? HF_SPEECH :
  providerArg === HF_FLASHHEAD.id || shot.kind === "dialogue" ? HF_FLASHHEAD : HF_VIDEO;
const provider = new FreeVideoProvider(token, fetch, profile);
const image = await readFile(resolve(root, shot.reference_path));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
if (digest(image) !== shot.reference_sha256 || image.length > 12 * 1024 * 1024 ||
  image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Referência PNG alterada, inválida ou grande demais");
let audio: Buffer | undefined;
if (shot.kind === "dialogue") {
  if (!shot.audio_path) throw new Error("Diálogo exige audio_path do WAV original");
  audio = await readFile(resolve(root, shot.audio_path));
  if (audio.length > 1024 * 1024 || digest(audio) !== shot.audio_sha256) throw new Error("Áudio original alterado ou grande demais");
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", resolve(root, shot.audio_path)], { encoding: "utf8", timeout: 30_000 });
  if (probe.status !== 0) throw new Error("Não foi possível conferir a duração real da voz");
  const media = JSON.parse(probe.stdout), voice = media.streams?.[0];
  if (media.streams?.length !== 1 || voice.codec_name !== "pcm_s16le" || voice.channels !== 1 || Number(voice.sample_rate) !== 16000 ||
    Math.abs(Number(media.format.duration) - shot.seconds) > .02) throw new Error("Diálogo exige PCM16 mono 16kHz e duração medida igual à tomada");
}
// Keep the fingerprint stable when descriptive capability metadata is extended.
const fingerprintProfile = { id: profile.id, space: profile.space, host: profile.host, revision: profile.revision, endpoint: profile.endpoint };
// The first audition used this legacy label; preserve its cache without inferring native motion FPS.
const { min_output_fps, ...fingerprintShot } = shot;
const parameters = profile.mode === "lipsync" ? { bbox_shift: 0, extra_margin: 10, parsing_mode: "jaw", left_cheek_width: 90, right_cheek_width: 90 } :
  profile.mode === "flashhead" ? { model_type: "lite", use_face_crop: false, source_audio_remux: true } :
  { steps: 6, guidance: 1 };
const key = await sha256Hex(canonicalStringify({ shot: { ...fingerprintShot, min_native_fps: min_output_fps }, provider: fingerprintProfile, ...parameters }));
const folder = join(out, key); await mkdir(folder, { recursive: true });
type State = { status: "prepared" | "submitting" | "accepted" | "downloaded" | "review" | "blocked" | "unknown";
  event_id?: string; output_url?: string; error_code?: string; output_sha256?: string };
const statePath = join(folder, "state.json");
let state = await read<State>(statePath, { status: "prepared" });
if (state.status === "review") {
  if (digest(await readFile(join(folder, "clip.mp4"))) !== state.output_sha256) throw new Error("Checkpoint alterado");
  await report("cache_reused", { job: key, path: join(folder, "clip.mp4"), human_review_pending: true });
  process.exit(0);
}
const lockPath = join(out, "provider.lock");
// One shared lock/attempt ledger for the HF account, not one allowance per Space.
let lock;
try { lock = await open(lockPath, "wx"); }
catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  await report("provider_busy", { job: key, note: "Uma execução está em andamento; não duplicar chamadas." });
  process.exit(2);
}
await lock.writeFile(String(process.pid)); await lock.close();
let phase = "preflight";
try {
    if (state.error_code === "generation_failed") {
      state = { ...state, status: "blocked" }; await save(statePath, state);
      throw new Error("Falha terminal confirmada; inspecionar antes de autorizar outra geração");
    }
    if (["submitting", "unknown", "blocked"].includes(state.status) && !state.event_id)
      throw new Error("Chamada anterior não conciliada. Não reenviar nem alternar provedor automaticamente.");
    if (state.status !== "prepared" && mode !== "--resume") throw new Error("Use --resume: há uma chamada anterior; não duplicar");
    if (state.status === "prepared") {
      if (mode !== "--run") throw new Error("Nenhuma chamada para retomar");
      const capacity = await provider.inspect();
      const ledgerPath = join(out, freeVideoQuotaLedger(profile));
      const ledger = await read(ledgerPath, { day: "", attempts: 0, cooldown_until: 0 });
      capacity.cooldown_until = ledger.cooldown_until;
      const routing = routeVideoShot(shot, [capacity]);
      await save(join(folder, "routing.json"), { ...routing, checked_at: new Date().toISOString(), capacity });
      if (!routing.selected) throw new Error(`Sem provedor compatível: ${routing.reasons.map(r => r.reason).join(", ")}`);
      const day = new Date().toISOString().slice(0, 10), attempts = ledger.day === day ? ledger.attempts : 0;
      if (attempts >= 2) throw new Error("Limite local de duas tentativas/dia atingido; não é a cota anunciada pelo provedor");
      await save(join(folder, "request.json"), { key, shot, provider: profile, ...(profile.mode === "i2v" ? { steps: 6 } :
        { motion_prompt_supported: false, seed_supported: profile.mode === "flashhead" }),
        ...(["lipsync", "flashhead"].includes(profile.mode) ? { parameters, body_motion_generated: false } : {}) });
      phase = "upload";
      const uploaded = await provider.upload(image, audio);
      // Persist reservation and unknown submission state BEFORE the non-idempotent request.
      await save(ledgerPath, { day, attempts: attempts + 1, cooldown_until: 0 });
      state = { status: "submitting" }; await save(statePath, state);
      phase = "submit";
      const eventId = await provider.submit(shot, uploaded);
      state = { status: "accepted", event_id: eventId }; await save(statePath, state);
      await report("video_accepted", { job: key, event_id: eventId, provider: profile.id });
    }
    if (!state.output_url && state.status !== "downloaded") {
      phase = "wait";
      const url = await provider.wait(state.event_id!, waitMs);
      state = { ...state, output_url: url }; await save(statePath, state);
    }
    if (state.status !== "downloaded") {
      phase = "download";
      const bytes = await provider.download(state.output_url!);
      let finalBytes = bytes;
      if (profile.mode === "flashhead") {
        if (!audio) throw new Error("FlashHead exige a voz original");
        const raw = join(folder, "raw-stream.mp4"), final = join(folder, "clip.mp4");
        await writeFile(raw, bytes);
        const normalization = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-i", resolve(root, shot.audio_path!),
          "-map", "0:v:0", "-map", "1:a:0", "-vf", "setpts=PTS-STARTPTS", "-t", String(shot.seconds), "-r", "25",
          "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final],
          { encoding: "utf8", timeout: 60_000 });
        if (normalization.status !== 0) throw new Error("Normalização de áudio/vídeo falhou");
        finalBytes = await readFile(final);
      } else await writeFile(join(folder, "clip.mp4"), bytes);
      state = { ...state, status: "downloaded", output_sha256: digest(finalBytes) }; await save(statePath, state);
    }
    phase = "audit";
    const video = join(folder, "clip.mp4");
    if (digest(await readFile(video)) !== state.output_sha256) throw new Error("Arquivo baixado alterado");
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", video], { encoding: "utf8", timeout: 30_000 });
    if (probe.status !== 0) throw new Error("ffprobe falhou");
    const info = JSON.parse(probe.stdout), stream = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
    const [num, den] = String(stream?.avg_frame_rate).split("/").map(Number), fps = Number(num) / Number(den);
    if (!stream || !Number.isFinite(fps) || fps < shot.min_output_fps ||
      Math.min(stream.width, stream.height) < shot.min_short_edge ||
      !Number.isFinite(Number(stream.duration ?? info.format.duration)) || Number(stream.duration ?? info.format.duration) + 1 / fps < shot.seconds)
      throw new Error("Mídia não cobre o contrato da tomada; sem completar com quadro congelado");
    if (shot.kind === "dialogue" && !info.streams?.some((s: { codec_type: string }) => s.codec_type === "audio"))
      throw new Error("Diálogo sem faixa de áudio");
    const decode = spawnSync("ffmpeg", ["-v", "error", "-xerror", "-i", video, "-f", "null", "-"], { encoding: "utf8", timeout: 60_000 });
    if (decode.status !== 0 || decode.stderr.trim()) throw new Error("Decode falhou");
    let audioAlignment: unknown = null;
    if (shot.kind === "dialogue") {
      const aligned = spawnSync("python", ["-X", "utf8", join(root, "scripts", "audit-free-story-dialogue.py"), video, resolve(root, shot.audio_path!)],
        { encoding: "utf8", timeout: 60_000 });
      if (aligned.status !== 0) throw new Error("A voz devolvida não passou na conferência de identidade e tempo; preservar download para inspeção");
      audioAlignment = JSON.parse(aligned.stdout);
    }
    await save(join(folder, "qa.json"), { decode_verified: true, width: stream.width, height: stream.height,
      encoded_fps: fps, expected_native_fps_from_source: profile.mode === "i2v" ? 16 : profile.mode === "flashhead" ? 25 : null,
      seconds: Number(info.format.duration), sha256: state.output_sha256,
      audio_alignment: audioAlignment,
      human_review_pending: true, lip_sync_verified: false, production_enabled: false, cash_charge_usd: 0,
      ...(profile.mode === "lipsync" ? { scope: "mouth inpainting over image; no generated body motion", parameters } : {}),
      ...(profile.mode === "flashhead" ? { scope: "dialogue close-up; no full-body motion or prompt-controlled acting",
        source_audio_remuxed: true, source_resolution: "512x512", parameters } : {}),
      visual_checks: ["identidade", "mãos e anatomia", "ação completa", "continuidade", "ausência de fala inventada"] });
    state = { ...state, status: "review" }; await save(statePath, state);
    await report("clip_ready_for_review", { job: key, path: video, human_review_pending: true, production_enabled: false });
} catch (error) {
  const code = error instanceof FreeVideoError ? error.code : phase === "preflight" ? "preflight_blocked" : "unknown";
  if (code === "quota_rejected" || code === "access_required" || code === "generation_failed") {
    const ledgerPath = join(out, freeVideoQuotaLedger(profile));
    const ledger = await read(ledgerPath, { day: new Date().toISOString().slice(0,10), attempts: 0, cooldown_until: 0 });
    await save(ledgerPath, { ...ledger, cooldown_until: Date.now() + 3_600_000 });
  }
  if (phase !== "preflight") {
    state = { ...state, status: state.status === "downloaded" ? "downloaded" : code === "generation_failed" ? "blocked" : state.event_id ? "accepted" : phase === "upload" ? "prepared" : "unknown", error_code: code };
    await save(statePath, state);
  }
  await report("video_blocked", { job: key, phase, code, can_resume: Boolean(state.event_id) && state.error_code !== "generation_failed",
    ...(phase === "preflight" ? { reason: error instanceof Error ? error.message : "Contrato inválido" } : {}) });
  process.exitCode = 2;
} finally { await unlink(lockPath); }
