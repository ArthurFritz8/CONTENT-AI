import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { getSystemConfig } from "./supabase-client.ts";
import { JobLogger } from "./logger.ts";
import {
  assertBufferChannel,
  createBufferTikTokPost,
  createBufferYoutubeShort,
  getBufferPostStatus,
} from "./buffer.ts";
import { bufferTikTokPlan } from "../../../packages/core/src/publish/buffer-tiktok-plan.ts";
import { bufferYoutubePlan } from "../../../packages/core/src/publish/buffer-youtube-plan.ts";
async function accessToken(db: SupabaseClient, workspace: string) {
  const { data: stored, error } = await db.rpc("studio_read_secret", {
    p_workspace: workspace,
    p_provider: "buffer",
  });
  if (error || !stored)
    throw new AppError("Conexão indisponível", 409, "BUFFER_RECONNECT");
  if (stored.expires_at > Date.now() + 90000)
    return stored.access_token as string;
  const { data: claim } = await db.rpc("studio_claim_refresh", {
    p_workspace: workspace,
  });
  if (!claim)
    throw new AppError(
      "Atualização de conexão pendente",
      409,
      "BUFFER_REFRESH_PENDING",
    );
  try {
    const id = Deno.env.get("BUFFER_CLIENT_ID"),
      secret = Deno.env.get("BUFFER_CLIENT_SECRET");
    if (!id || !secret) throw Error();
    const r = await fetch("https://auth.buffer.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const token = await r.json();
    if (
      !r.ok ||
      typeof token.access_token !== "string" ||
      typeof token.refresh_token !== "string" ||
      !Number.isFinite(token.expires_in)
    )
      throw Error();
    const { error: save } = await db.rpc("studio_store_secret", {
      p_workspace: workspace,
      p_provider: "buffer",
      p_value: { ...token, expires_at: Date.now() + token.expires_in * 1000 },
    });
    if (save) throw Error();
    await db
      .from("studio_connections")
      .update({ refresh_claimed_at: null })
      .eq("workspace_id", workspace)
      .eq("provider", "buffer");
    return token.access_token as string;
  } catch {
    await db
      .from("studio_connections")
      .update({ status: "reconnect" })
      .eq("workspace_id", workspace)
      .eq("provider", "buffer");
    throw new AppError("Reconecte o Buffer", 409, "BUFFER_RECONNECT");
  }
}
/** Only called after the DB atomically claims explicit approval for this channel and fingerprint. */
async function publicApprovedMedia(db: SupabaseClient, raw: string) {
  const url = new URL(raw),
    prefix = "/storage/v1/object/authenticated/studio-private/";
  if (!url.pathname.startsWith(prefix)) return raw;
  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  const { data: blob, error } = await db.storage
    .from("studio-private")
    .download(path);
  if (error || !blob || blob.size > 52428800)
    throw new AppError("Mídia indisponível", 422, "MEDIA_UNAVAILABLE");
  // The render path contains its SHA-256. Confirm bytes before exposing an approved copy.
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  if (!path.includes(`/final/${hash}/`))
    throw new AppError("Mídia mudou", 422, "MEDIA_CHANGED");
  const { error: upload } = await db.storage
    .from("studio-published")
    .upload(path, blob, { contentType: "video/mp4", upsert: true });
  if (upload)
    throw new AppError("Falha na cópia aprovada", 502, "MEDIA_UPLOAD_FAILED");
  return db.storage.from("studio-published").getPublicUrl(path).data.publicUrl;
}
export async function dispatchStudioPost(db: SupabaseClient) {
  const logger = new JobLogger(db, "studio-publisher");
  // Never reclaim an ambiguous createPost, even after a process crash.
  await db
    .from("studio_outbox")
    .update({ status: "uncertain", error_code: "WORKER_INTERRUPTED" })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 600000).toISOString());
  const { data: waiting } = await db
    .from("studio_outbox")
    .select("id,workspace_id,channel_id,external_id,episode_id")
    .eq("status", "scheduled")
    .lt("updated_at", new Date(Date.now() - 1800000).toISOString())
    .order("updated_at")
    .limit(1);
  if (waiting?.[0]) {
    const o = waiting[0];
    try {
      const token = await accessToken(db, o.workspace_id),
        { data: c } = await db
          .from("studio_channels")
          .select("external_id")
          .eq("id", o.channel_id)
          .eq("workspace_id", o.workspace_id)
          .single();
      const status = await getBufferPostStatus(
        token,
        o.external_id,
        c!.external_id,
      );
      await db
        .from("studio_outbox")
        .update({
          status:
            status === "sent"
              ? "published"
              : status === "error"
                ? "failed"
                : "scheduled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", o.id);
    } catch {
      await db
        .from("studio_outbox")
        .update({
          updated_at: new Date().toISOString(),
          error_code: "STATUS_UNAVAILABLE",
        })
        .eq("id", o.id);
    }
    return { studio_post_checked: true };
  }
  const { data: job, error } = await db.rpc("studio_claim_post");
  if (error)
    throw new AppError("Falha ao reservar publicação", 500, "DB_ERROR");
  if (!job) return null;
  const { outbox: o, channel: c, snapshot } = job;
  let creationStarted = false;
  try {
    if (o.due_at && Date.parse(o.due_at) <= Date.now() + 60000)
      throw new AppError("Horário expirou", 409, "SCHEDULE_EXPIRED");
    const origin = Deno.env.get("SUPABASE_URL") || "",
      yt = await getSystemConfig(db, "youtube", {});
    const plan =
      c.platform === "tiktok"
        ? bufferTikTokPlan(snapshot, origin)
        : bufferYoutubePlan(snapshot, yt, origin);
    const token = await accessToken(db, o.workspace_id);
    await assertBufferChannel(token, c.external_id, c.platform);
    const videoUrl = await publicApprovedMedia(db, plan.videoUrl);
    creationStarted = true;
    const post =
      c.platform === "tiktok"
        ? await createBufferTikTokPost(token, c.external_id, {
            ...bufferTikTokPlan(snapshot, origin),
            videoUrl,
            dueAt: o.due_at || undefined,
          })
        : await createBufferYoutubeShort(token, c.external_id, {
            ...bufferYoutubePlan(snapshot, yt, origin),
            videoUrl,
            dueAt: o.due_at || undefined,
          });
    const { error: save } = await db
      .from("studio_outbox")
      .update({
        status:
          post.status === "sent"
            ? "published"
            : post.status === "error"
              ? "failed"
              : "scheduled",
        external_id: post.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", o.id)
      .eq("status", "sending");
    if (save)
      throw new AppError("Confirmação pendente", 502, "BUFFER_UNCERTAIN");
    await logger.event({
      episode_id: o.episode_id,
      event_type: "publish_started",
      metadata: { provider: "buffer", outbox_id: o.id, channel: c.id },
    });
    return { studio_post_scheduled: true, episode_id: o.episode_id };
  } catch (e) {
    const code = e instanceof AppError ? e.code : "PUBLICATION_FAILED";
    await db
      .from("studio_outbox")
      .update({
        status:
          creationStarted && code !== "BUFFER_REJECTED"
            ? "uncertain"
            : "failed",
        error_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", o.id);
    logger.error("Publicação não confirmada", new Error(code));
    return { studio_post_scheduled: false, code };
  }
}
