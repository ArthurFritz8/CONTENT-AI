import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { bufferYoutubePlan } from "../../../packages/core/src/publish/buffer-youtube-plan.ts";
import { AppError } from "./error-handler.ts";
import { assertBufferChannel, createBufferYoutubeShort, getBufferPostStatus } from "./buffer.ts";
import { JobLogger } from "./logger.ts";
import { getSystemConfig } from "./supabase-client.ts";

interface BufferYoutubeConfig { enabled?: boolean; automatic_after?: string | null }
interface DirectYoutubeConfig { public_shorts_enabled?: boolean; api_audit_approved?: boolean }

/** Schedules only explicitly approved organic Shorts on the connected Buffer YouTube channel. */
export async function dispatchApprovedBufferYoutube(
  db: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const cfg = await getSystemConfig<BufferYoutubeConfig>(db, "buffer_youtube", {});
  const activation = cfg.automatic_after ? Date.parse(cfg.automatic_after) : NaN;
  if (!cfg.enabled || !Number.isFinite(activation) || activation > Date.now()) return null;
  const youtube = await getSystemConfig<DirectYoutubeConfig>(db, "youtube", {});
  if (youtube.public_shorts_enabled && youtube.api_audit_approved) return null;
  const key = Deno.env.get("BUFFER_API_KEY");
  const channelId = Deno.env.get("BUFFER_YOUTUBE_CHANNEL_ID");
  if (!key || !channelId) return null;
  const logger = new JobLogger(db, "buffer-youtube-dispatch");

  const { data: pending, error: pendingError } = await db.from("publishes")
    .select("id,episode_id,external_id,channel_id")
    .eq("platform", "youtube").eq("variant", "portrait").eq("status", "processing")
    .contains("upload_config", { provider: "buffer" }).not("external_id", "is", null)
    .lt("provider_checked_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("provider_checked_at", { ascending: true }).limit(1);
  if (pendingError) throw new AppError("Falha ao consultar Shorts Buffer", 500, "DB_ERROR");
  const awaiting = pending?.[0];
  if (awaiting?.external_id && awaiting.channel_id) {
    try {
      const status = await getBufferPostStatus(key, awaiting.external_id, awaiting.channel_id);
      if (["scheduled", "sending", "sent", "error"].includes(status)) {
        const { error } = await db.rpc("record_buffer_youtube_status", {
          p_id: awaiting.id, p_external_id: awaiting.external_id, p_status: status,
        });
        if (error) throw new AppError("Falha ao registrar status Buffer", 500, "DB_ERROR");
        return { buffer_youtube_reconciled: true, episode_id: awaiting.episode_id, status };
      }
      logger.error("Short Buffer deixou o fluxo automático", new Error(status), { episode_id: awaiting.episode_id });
    } catch (error) {
      logger.error("Consulta Buffer falhou; será retomada sem reenviar", error, { episode_id: awaiting.episode_id });
    }
  }

  const { data: episodes, error } = await db.from("episodes")
    .select("id,approval_date,approval_fingerprint")
    .eq("status", "review").not("approval_fingerprint", "is", null)
    .gte("approval_date", new Date(activation).toISOString())
    .order("approval_date", { ascending: true }).limit(20);
  if (error) throw new AppError("Falha ao buscar Shorts aprovados", 500, "DB_ERROR");
  for (const episode of episodes ?? []) {
    const { data: existing, error: existingError } = await db.from("publishes")
      .select("id").eq("episode_id", episode.id).eq("platform", "youtube")
      .eq("variant", "portrait").maybeSingle();
    if (existingError) throw new AppError("Falha ao consultar ledger YouTube", 500, "DB_ERROR");
    if (existing) continue;
    const { data: review, error: reviewError } = await db.from("review_requests")
      .select("id,snapshot").eq("episode_id", episode.id)
      .eq("fingerprint", episode.approval_fingerprint).eq("decision", "approved")
      .eq("buffer_youtube_consent", true).maybeSingle();
    if (reviewError) throw new AppError("Falha ao conferir autorização YouTube", 500, "DB_ERROR");
    if (!review) continue;
    let plan: ReturnType<typeof bufferYoutubePlan>;
    try { plan = bufferYoutubePlan(review.snapshot, youtube, Deno.env.get("SUPABASE_URL") ?? ""); }
    catch (error) { logger.error("Short inválido para Buffer", error, { episode_id: episode.id }); continue; }
    if (plan.episodeId !== episode.id) continue;
    try { await assertBufferChannel(key, channelId, "youtube"); }
    catch (error) { logger.error("Canal YouTube do Buffer indisponível", error); return null; }
    const owner = crypto.randomUUID();
    const { data: reserved, error: reserveError } = await db.rpc("reserve_buffer_youtube_short", {
      p_episode_id: episode.id, p_owner: owner,
    });
    if (reserveError) { logger.error("Reserva YouTube Buffer recusada", reserveError, { episode_id: episode.id }); continue; }
    const row = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!row?.id || row.lease_owner !== owner || row.external_id) continue;
    try {
      const post = await createBufferYoutubeShort(key, channelId, plan);
      const { error: checkpointError } = await db.rpc("record_buffer_youtube_short", {
        p_id: row.id, p_owner: owner, p_external_id: post.id, p_channel_id: channelId,
      });
      if (checkpointError) throw new AppError("Short criado no Buffer, mas checkpoint falhou", 500, "BUFFER_CHECKPOINT_FAILED");
      if (post.status === "sent" || post.status === "error") {
        const { error: statusError } = await db.rpc("record_buffer_youtube_status", {
          p_id: row.id, p_external_id: post.id, p_status: post.status,
        });
        if (statusError) throw new AppError("Falha ao registrar publicação Buffer", 500, "DB_ERROR");
      }
      return { buffer_youtube_scheduled: true, episode_id: episode.id, post_id: post.id, status: post.status };
    } catch (error) {
      // A timeout can follow a successful mutation. Keep the reservation and never submit a duplicate.
      logger.error("Envio YouTube incerto; conferir fila e ledger antes de reparar", error,
        { episode_id: episode.id, publish_id: row.id });
      await logger.event({ episode_id: episode.id, event_type: "failed", metadata: {
        platform: "youtube", provider: "buffer", publish_id: row.id,
        code: error instanceof AppError ? error.code : "BUFFER_UNCERTAIN",
      } });
      return { buffer_youtube_scheduled: false, episode_id: episode.id, reason: "manual_reconciliation_required" };
    }
  }
  return null;
}
