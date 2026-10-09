/** One bounded silent audition. No Studio wallet, production episode, publishing or Modal calls. */
import { readFile, writeFile, mkdir, rename, open, unlink } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { z } from "zod";
import { AURAY, AurayError, AurayVideoProvider, aurayAuditionKey, aurayAuditionSchema } from "../apps/local-renderer/src/auray-video-provider.ts";

const root = resolve(import.meta.dirname,".."), out = resolve(root,process.env.CONTENT_AI_AURAY_OUTPUT_DIR ?? "output/auray-video-jobs");
const checkpointSchema = z.object({ version: z.literal(1), request_key: z.string().regex(/^[a-f0-9]{64}$/),
  account_id: z.string().uuid(), key_id: z.string().min(1), period: z.string().regex(/^\d{4}-\d{2}$/),
  contract_sha256: z.string().regex(/^[a-f0-9]{64}$/), shot: aurayAuditionSchema,
  phase: z.enum(["upload_pending","submission_started","submitted","submission_unknown","rejected","waiting","failed","downloaded","review_pending"]),
  job_id: z.string().regex(/^video_[a-f0-9]{64}$/), updated_at: z.string().datetime(),
  error_code: z.string().optional(), charged_credits: z.number().int().min(0).max(5).optional(),
  settled: z.boolean().optional(), output_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
type Checkpoint = z.infer<typeof checkpointSchema>;
async function save(path: string, value: unknown) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(value,null,2)+"\n",{ mode: 0o600 }); await rename(temp,path);
}
async function token() {
  if (process.env.AURAY_API_KEY?.trim()) return process.env.AURAY_API_KEY.trim();
  try {
    const env = await readFile(join(root,".env.cloud"),"utf8");
    const line = env.split(/\r?\n/).find(l => /^AURAY_API_KEY\s*=/.test(l));
    return line?.slice(line.indexOf("=")+1).trim().replace(/^(['"])(.*)\1$/,"$2") || undefined;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new AurayError("credential_file_unavailable"); return undefined; }
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function verifyMedia(path: string, shot: Checkpoint["shot"]) {
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
  return { seconds: duration, width,height, encoded_fps: fps, decoded_frames: frames,
    has_audio: Boolean(media.streams?.some((s: { codec_type: string }) => s.codec_type === "audio")),
    native_motion_fps: null, dialogue_approved: false, continuity_approved: false, editorial_status: "review_pending",
    note: "Arquivo original. FPS codificado não comprova fluidez, poses novas, anatomia ou identidade. Prévia isolada; não entra na novela." };
}
async function main() {
  const inside = relative(join(root,"output"),out);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new AurayError("output_directory_outside_workspace");
  const mode = process.argv[2], input = process.argv[3];
  if (!["--inspect","--run","--resume"].includes(mode ?? "")) throw new AurayError("use_inspect_run_or_resume");
  await mkdir(out,{ recursive: true });
  const provider = new AurayVideoProvider(await token());
  if (mode === "--inspect") {
    const report = await provider.inspect(); await save(join(out,"inspection.json"),report);
    process.stdout.write(JSON.stringify(report)+"\n"); return;
  }
  if (!input) throw new AurayError("plan_or_checkpoint_required");
  const waitArg = process.argv.find(v => v.startsWith("--wait-seconds="));
  const waitSeconds = waitArg ? Number(waitArg.split("=")[1]) : 0;
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 2400) throw new AurayError("invalid_wait_seconds");
  if (mode === "--run" && !process.argv.includes("--allow-free-audition")) throw new AurayError("explicit_audition_flag_required");
  const lockPath = join(out,"provider.lock");
  let lock;
  try { lock = await open(lockPath,"wx",0o600); } catch { throw new AurayError("provider_locked"); }
  let state: Checkpoint | undefined, statePath: string | undefined;
  const update = async (patch: Partial<Checkpoint>) => {
    if (!state || !statePath) throw new AurayError("checkpoint_missing");
    state = checkpointSchema.parse({ ...state,...patch,updated_at: new Date().toISOString() }); await save(statePath,state);
  };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid,at: new Date().toISOString() }));
    if (mode === "--resume") {
      state = checkpointSchema.parse(JSON.parse(await readFile(resolve(input),"utf8")));
      // Never trust a checkpoint-supplied host or path; all destinations derive from its validated key.
      const expected = aurayAuditionKey(state.shot,{ account_id: state.account_id,period: state.period,
        contract_sha256: state.contract_sha256 } as Parameters<typeof aurayAuditionKey>[1]);
      if (expected !== state.request_key || state.job_id !== `video_${expected}`) throw new AurayError("checkpoint_mismatch");
      statePath = join(out,expected,"state.json");
      if (resolve(input) !== statePath) throw new AurayError("use_original_checkpoint");
      if (["upload_pending","rejected"].includes(state.phase)) throw new AurayError("submission_not_authorized_to_resume");
    } else {
      const shot = aurayAuditionSchema.parse(JSON.parse(await readFile(resolve(input),"utf8")));
      const report = await provider.inspect(); await save(join(out,"inspection.json"),report);
      if (!report.financially_eligible) throw new AurayError(`financial_gate_closed:${report.blockers.join(",")}`);
      const requestKey = aurayAuditionKey(shot,report), directory = join(out,requestKey);
      await mkdir(directory,{ recursive: true }); statePath = join(directory,"state.json");
      // Even a rejected or uncertain previous submission is never retried automatically.
      try { await readFile(statePath); throw new AurayError("existing_checkpoint_use_resume"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const image = await readFile(resolve(root,shot.reference_path));
      if (hash(image) !== shot.reference_sha256 || image.length > AURAY.maxImageBytes) throw new AurayError("reference_changed");
      const metadata = await sharp(image,{ limitInputPixels: 20_000_000 }).metadata();
      if (metadata.format !== "png" || !metadata.width || !metadata.height ||
          Math.abs(metadata.width/metadata.height - (shot.aspect_ratio === "9:16" ? 9/16 : 16/9)) > .025) throw new AurayError("reference_invalid");
      state = { version:1,request_key:requestKey,account_id:report.account_id!,key_id:report.key_id!,period:report.period!,
        contract_sha256:report.contract_sha256!,shot,phase:"upload_pending",job_id:`video_${requestKey}`,updated_at:new Date().toISOString() };
      await save(statePath,state);
      const firstFramePath = await provider.upload(image,requestKey,state.account_id);
      // Save the deterministic job ID BEFORE POST. A crash here requires read-only reconciliation, not another submit.
      await update({ phase:"submission_started" });
      try { await provider.submit(shot,firstFramePath,requestKey,report); await update({ phase:"submitted" }); }
      catch (e) { const unknown = !(e instanceof AurayError) || e.acceptance === "unknown";
        await update({ phase:unknown ? "submission_unknown" : "rejected",error_code:e instanceof AurayError ? e.code : "unknown" }); throw e; }
    }
    const directory = join(out,state.request_key), file = join(directory,"original.mp4");
    if (state.phase === "review_pending") {
      if (!state.output_sha256 || hash(await readFile(file)) !== state.output_sha256) throw new AurayError("cached_output_changed");
      process.stdout.write(JSON.stringify({ status:"review_pending",checkpoint:statePath,file,production_ready:false })+"\n"); return;
    }
    const deadline = Date.now() + waitSeconds * 1000;
    let job = await provider.status(state.job_id);
    // One accepted job, automatic polling. Every pause is bounded; restart uses the same saved ID.
    while ((!job.settled || ["queued","running"].includes(job.status)) && Date.now() < deadline) {
      await update({ phase:"waiting",charged_credits:job.credits_charged,settled:job.settled });
      process.stdout.write(JSON.stringify({ status:job.status,settled:job.settled,checkpoint:statePath,production_ready:false })+"\n");
      await new Promise(r => setTimeout(r,Math.min(60_000,Math.max(15,job.poll_after_seconds)*1000,deadline-Date.now())));
      job = await provider.status(state.job_id);
    }
    await update({ charged_credits:job.credits_charged,settled:job.settled });
    if (job.status === "failed" || job.status === "cancelled") { await update({ phase:"failed" }); throw new AurayError("job_failed_no_retry"); }
    if (job.status !== "succeeded" || !job.settled) {
      await update({ phase:"waiting" });
      process.stdout.write(JSON.stringify({ status:job.status,settled:job.settled,checkpoint:statePath,
        poll_after_seconds:Math.max(15,job.poll_after_seconds),next:"--resume",production_ready:false })+"\n"); return;
    }
    if (state.phase !== "downloaded") {
      const bytes = await provider.download(state.job_id); await writeFile(file,bytes,{ mode:0o600 });
      await update({ phase:"downloaded",output_sha256:hash(bytes) });
    }
    if (hash(await readFile(file)) !== state.output_sha256) throw new AurayError("cached_output_changed");
    const qa = { ...await verifyMedia(file,state.shot),source:"auray",model:AURAY.model,
      contract_sha256:state.contract_sha256,reference_sha256:state.shot.reference_sha256,
      output_sha256:state.output_sha256,charged_credits:state.charged_credits,
      attribution:"Generated with MiniMax via Auray · AI-generated",license_review_required:true };
    await save(join(directory,"qa.json"),qa);
    await update({ phase:"review_pending" });
    process.stdout.write(JSON.stringify({ status:"review_pending",file,checkpoint:statePath,...qa,production_ready:false })+"\n");
  } finally { await lock.close(); await unlink(lockPath); }
}
try { await main(); } catch (e) {
  // Do not print raw network/SDK errors, environment values, provider prose or signed links.
  process.stderr.write(JSON.stringify({ status:"blocked",code:e instanceof AurayError ? e.code : "invalid_input_or_local_io",
    acceptance:e instanceof AurayError ? e.acceptance : "unknown",production_ready:false })+"\n"); process.exitCode = 1;
}
