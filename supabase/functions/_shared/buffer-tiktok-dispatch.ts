import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { bufferTikTokPlan } from "../../../packages/core/src/publish/buffer-tiktok-plan.ts";
import { AppError } from "./error-handler.ts";
import {
  assertBufferTikTokChannel,
  createBufferTikTokPost,
  getBufferPostStatus,
} from "./buffer.ts";
import { JobLogger } from "./logger.ts";
import { getSystemConfig } from "./supabase-client.ts";

interface BufferConfig {
  enabled?: boolean;
  automatic_after?: string | null;
}

/** Buffer owns TikTok OAuth and public-posting eligibility. No direct TikTok API or private uploader. */
export async function dispatchApprovedBufferTikTok(
  db: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const cfg = await getSystemConfig<BufferConfig>(db, "buffer_tiktok", {});
  const activation = cfg.automatic_after
    ? Date.parse(cfg.automatic_after)
    : NaN;
  if (!cfg.enabled || !Number.isFinite(activation) || activation > Date.now()) {
    return null;
  }
  const key = Deno.env.get("BUFFER_API_KEY");
  const channelId = Deno.env.get("BUFFER_TIKTOK_CHANNEL_ID");
  if (!key || !channelId) return null;
  const logger = new JobLogger(db, "buffer-tiktok-dispatch");

  // Read-only status checks can repeat. Creation below cannot: one durable reservation per episode.
  const { data: pending, error: pendingError } = await db.from("publishes")
    .select("id,episode_id,external_id,channel_id")
    .eq("platform", "tiktok").eq("variant", "portrait").eq(
      "status",
      "processing",
    )
    .not("external_id", "is", null)
    .lt("provider_checked_at", new Date(Date.now() - 30 * 60_000).toISOString())
    .order("provider_checked_at", { ascending: true }).limit(1);
  if (pendingError) {
    throw new AppError("Falha ao consultar envios Buffer", 500, "DB_ERROR");
  }
  const awaiting = pending?.[0];
  if (awaiting?.external_id && awaiting.channel_id) {
    try {
      const status = await getBufferPostStatus(
        key,
        awaiting.external_id,
        awaiting.channel_id,
      );
      if (["scheduled", "sending", "sent", "error"].includes(status)) {
        const { error } = await db.rpc("record_buffer_tiktok_status", {
          p_id: awaiting.id,
          p_external_id: awaiting.external_id,
          p_status: status,
        });
        if (error) {
          throw new AppError(
            "Falha ao registrar status Buffer",
            500,
            "DB_ERROR",
          );
        }
        return {
          buffer_reconciled: true,
          episode_id: awaiting.episode_id,
          status,
        };
      }
      logger.error("Post Buffer deixou o fluxo automático", new Error(status), {
        episode_id: awaiting.episode_id,
      });
    } catch (error) {
      logger.error(
        "Consulta Buffer falhou; será retomada sem reenviar",
        error,
        { episode_id: awaiting.episode_id },
      );
    }
  }

  const { data: episodes, error } = await db.from("episodes")
    .select("id,approval_date,approval_fingerprint")
    .eq("status", "review").not("approval_fingerprint", "is", null)
    .gte("approval_date", new Date(activation).toISOString())
    .order("approval_date", { ascending: true }).limit(20);
  if (error) {
    throw new AppError("Falha ao buscar TikToks aprovados", 500, "DB_ERROR");
  }
  for (const episode of episodes ?? []) {
    const { data: existing, error: existingError } = await db.from("publishes")
      .select("id").eq("episode_id", episode.id).eq("platform", "tiktok")
      .eq("variant", "portrait").maybeSingle();
    if (existingError) {
      throw new AppError("Falha ao consultar ledger TikTok", 500, "DB_ERROR");
    }
    if (existing) continue;
    const { data: review, error: reviewError } = await db.from(
      "review_requests",
    )
      .select("id,snapshot").eq("episode_id", episode.id).eq(
        "fingerprint",
        episode.approval_fingerprint,
      )
      .eq("decision", "approved").eq("buffer_tiktok_consent", true)
      .maybeSingle();
    if (reviewError) {
      throw new AppError(
        "Falha ao conferir autorização TikTok",
        500,
        "DB_ERROR",
      );
    }
    if (!review) continue;
    let plan: ReturnType<typeof bufferTikTokPlan>;
    try {
      plan = bufferTikTokPlan(
        review.snapshot,
        Deno.env.get("SUPABASE_URL") ?? "",
      );
    } catch (error) {
      logger.error("Render TikTok inválido para Buffer", error, {
        episode_id: episode.id,
      });
      continue;
    }
    if (plan.episodeId !== episode.id) continue;
    // Validate the connected channel before creating the durable reservation.
    try {
      await assertBufferTikTokChannel(key, channelId);
    } catch (error) {
      logger.error(
        "Canal TikTok do Buffer indisponível; geração permanece independente",
        error,
      );
      return null;
    }
    const owner = crypto.randomUUID();
    const { data: reserved, error: reserveError } = await db.rpc(
      "reserve_buffer_tiktok_post",
      { p_episode_id: episode.id, p_owner: owner },
    );
    if (reserveError) {
      logger.error("Reserva Buffer recusada", reserveError, {
        episode_id: episode.id,
      });
      continue;
    }
    const row = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!row?.id || row.lease_owner !== owner || row.external_id) continue;
    try {
      const post = await createBufferTikTokPost(key, channelId, plan);
      const { error: checkpointError } = await db.rpc(
        "record_buffer_tiktok_post",
        {
          p_id: row.id,
          p_owner: owner,
          p_external_id: post.id,
          p_channel_id: channelId,
        },
      );
      if (checkpointError) {
        throw new AppError(
          "Post criado no Buffer, mas checkpoint falhou; reconciliar manualmente",
          500,
          "BUFFER_CHECKPOINT_FAILED",
        );
      }
      if (post.status === "sent" || post.status === "error") {
        const { error: statusError } = await db.rpc(
          "record_buffer_tiktok_status",
          {
            p_id: row.id,
            p_external_id: post.id,
            p_status: post.status,
          },
        );
        if (statusError) {
          throw new AppError(
            "Falha ao registrar publicação Buffer",
            500,
            "DB_ERROR",
          );
        }
      }
      return {
        buffer_scheduled: true,
        episode_id: episode.id,
        post_id: post.id,
        status: post.status,
      };
    } catch (error) {
      // The mutation may have succeeded before a timeout. Never submit another post automatically.
      logger.error(
        "Envio Buffer incerto; conferir fila e ledger antes de reparar",
        error,
        { episode_id: episode.id, publish_id: row.id },
      );
      await logger.event({
        episode_id: episode.id,
        event_type: "failed",
        metadata: {
          platform: "tiktok",
          provider: "buffer",
          publish_id: row.id,
          code: error instanceof AppError ? error.code : "BUFFER_UNCERTAIN",
        },
      });
      return {
        buffer_scheduled: false,
        episode_id: episode.id,
        reason: "manual_reconciliation_required",
      };
    }
  }
  return null;
}
