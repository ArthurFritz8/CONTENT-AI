import { z } from "zod";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const manifest = z.object({ kind: z.literal("manifest"), name: z.enum(["native", "fluid"]),
  size: z.number().int().min(1).max(30 * 1024 * 1024), sha256: sha }).strict();
const report = z.object({ execution_sha256: sha, reference_sha256: sha, input_audio_sha256: sha,
  audio_conditioned: z.literal(true), lip_sync_validated: z.literal(false), human_review_required: z.literal(true),
  native_fps: z.literal(16), native_frames: z.literal(64), output_fps: z.literal(60), output_frames: z.literal(237),
  width: z.literal(704), height: z.literal(1280), input_audio_seconds: z.number().finite().positive().max(63 / 16),
  no_loop_no_speed_change: z.literal(true), raw_native_rgb_sha256: sha }).passthrough();
const schema = z.discriminatedUnion("action", [
  z.object({ job_id: z.string().uuid(), action: z.literal("begin"), external_id: z.string().regex(/^fc-[A-Za-z0-9_-]{1,100}$/) }).strict(),
  z.object({ job_id: z.string().uuid(), action: z.literal("complete"), report,
    manifests: z.object({ native: manifest, fluid: manifest }).strict() }).strict(),
  z.object({ job_id: z.string().uuid(), action: z.literal("failed"), code: z.string().regex(/^[A-Z_]{1,64}$/) }).strict(),
]);
async function hash(data: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function boundedBody(req: Request) {
  if (!req.body) return "";
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 30000) {
        await reader.cancel();
        throw new AppError("Body excede limite", 413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** Gateway JWT is disabled ONLY here; a job-specific, expiring capability authenticates each action. */
export async function handleVideoWorker(req: Request, client: () => SupabaseClient = createServiceClient): Promise<Response> {
  try {
    if (req.method !== "POST") throw new AppError("Método inválido", 405, "METHOD_NOT_ALLOWED");
    const capability = req.headers.get("x-video-worker-capability");
    if (!capability || !/^[a-f0-9]{64}$/.test(capability)) throw new AppError("Acesso negado", 401, "UNAUTHORIZED");
    const body = await boundedBody(req);
    let input: z.infer<typeof schema>;
    try { input = schema.parse(JSON.parse(body)); }
    catch { throw new AppError("Input inválido", 400, "VALIDATION_ERROR"); }
    const db = client(), capabilityHash = await hash(new TextEncoder().encode(capability));
    // Check capability before reading either a job or its private object locations.
    const { data: ticket, error: ticketError } = await db.from("studio_video_worker_tickets")
      .select("bucket,output_prefix,expires_at,started_at,lease_token")
      .eq("job_id", input.job_id).eq("capability_sha256", capabilityHash).maybeSingle();
    if (ticketError) throw new AppError("Falha ao consultar tarefa", 500, "DB_ERROR");
    if (!ticket || Date.parse(ticket.expires_at) <= Date.now()) throw new AppError("Acesso negado", 401, "UNAUTHORIZED");
    let name: string, args: Record<string, unknown> = { p_job: input.job_id, p_capability: capabilityHash };
    if (input.action === "begin") {
      name = "begin_video_worker"; args.p_external = input.external_id;
    } else if (input.action === "failed") {
      name = "fail_video_worker"; args.p_code = input.code;
    } else {
      if (!ticket.started_at || input.manifests.native.name !== "native" || input.manifests.fluid.name !== "fluid")
        throw new AppError("Tarefa não iniciada", 409, "INVALID_STATE");
      for (const variant of ["native", "fluid"] as const) {
        const { data, error } = await db.storage.from(ticket.bucket).download(`${ticket.output_prefix}/${variant}.mp4`);
        if (error || !data) throw new AppError("Objeto ainda não disponível", 409, "OUTPUT_PENDING");
        if (data.size !== input.manifests[variant].size || await hash(new Uint8Array(await data.arrayBuffer())) !== input.manifests[variant].sha256)
          throw new AppError("Objeto difere do manifesto", 422, "OUTPUT_MISMATCH");
      }
      name = "complete_video_worker"; args = { ...args, p_report: input.report, p_manifests: input.manifests };
    }
    const { data, error } = await db.rpc(name, args);
    if (error) throw new AppError("Callback recusado", error.code === "42501" ? 401 : 409, "WORKER_CALLBACK_REJECTED");
    return jsonResponse(data);
  } catch (e) { return toErrorResponse(e); }
}
