import { requireServiceRole } from "../_shared/auth.ts";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { claimEpisode } from "../_shared/episode-lease.ts";
import { dispatchGithub } from "../_shared/github-dispatch.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { parseJsonBody, triggerRenderInputSchema } from "../_shared/validators.ts";

// Explicit pilot dispatch only; orchestrator does not upload automatically (ADR-019).
export async function handlePublishYoutube(req: Request): Promise<Response> {
  let release: (() => Promise<void>) | undefined;
  try {
    requireServiceRole(req);
    if (req.method !== "POST") throw new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED");
    const { episode_id } = await parseJsonBody(req, triggerRenderInputSchema.pick({ episode_id: true }).strict());
    const db = createServiceClient();
    if ((await getSystemConfig<{ enabled?: boolean }>(db, "youtube", {})).enabled !== true) return jsonResponse({ paused: true });
    release = await claimEpisode(db, episode_id);
    const { data, error } = await db.from("episodes").select("status,approval_fingerprint,metadata").eq("id", episode_id).maybeSingle();
    if (error) throw new AppError("Falha ao ler episódio", 500, "DB_ERROR");
    if (!data || data.status !== "review" || !data.approval_fingerprint) throw new AppError("Revisão aprovada necessária", 409, "REVIEW_REQUIRED");
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const last = typeof metadata.youtube_dispatch_at === "string" ? Date.parse(metadata.youtube_dispatch_at) : 0;
    if (Date.now() - last < 20 * 60_000) return jsonResponse({ dispatched: false, reason: "dispatch_recent" });
    const saved = await db.from("episodes").update({ metadata: { ...metadata, youtube_dispatch_at: new Date().toISOString() } }).eq("id", episode_id);
    if (saved.error) throw new AppError("Falha ao reservar dispatch", 500, "DB_ERROR");
    await dispatchGithub("publish-youtube.yml", episode_id);
    return jsonResponse({ dispatched: true, privacy: "private", variant: "landscape" }, 202);
  } catch (error) { return toErrorResponse(error); }
  finally { await release?.(); }
}
