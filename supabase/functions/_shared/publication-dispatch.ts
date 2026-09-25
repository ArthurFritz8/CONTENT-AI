import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { claimEpisode } from "./episode-lease.ts";
import { dispatchGithub } from "./github-dispatch.ts";
import { JobLogger } from "./logger.ts";
import { getSystemConfig } from "./supabase-client.ts";

interface YoutubeConfig {
  enabled?: boolean;
  public_shorts_enabled?: boolean;
  api_audit_approved?: boolean;
  automatic_after?: string | null;
}

/** Only approvals after activation are eligible; a paused generation pipeline can still publish them. */
export async function dispatchApprovedShort(db: SupabaseClient): Promise<Record<string, unknown> | null> {
  const cfg = await getSystemConfig<YoutubeConfig>(db, "youtube", {});
  const activation = cfg.automatic_after ? Date.parse(cfg.automatic_after) : NaN;
  if (!cfg.enabled || !cfg.public_shorts_enabled || !cfg.api_audit_approved || !Number.isFinite(activation)) return null;
  const { data: episodes, error } = await db.from("episodes")
    .select("id,approval_date,approval_fingerprint,metadata")
    .eq("status", "review").not("approval_fingerprint", "is", null)
    .gte("approval_date", new Date(activation).toISOString())
    .order("approval_date", { ascending: false }).limit(20);
  if (error) throw new AppError("Falha ao buscar Shorts aprovados", 500, "DB_ERROR");
  for (const episode of episodes ?? []) {
    const { data: existing, error: publishError } = await db.from("publishes")
      .select("id,status").eq("episode_id", episode.id).eq("platform", "youtube")
      .eq("variant", "portrait").maybeSingle();
    if (publishError) throw new AppError("Falha ao consultar publicação", 500, "DB_ERROR");
    if (existing?.status === "published") continue;
    const { data: consent, error: consentError } = await db.from("review_requests")
      .select("id").eq("episode_id", episode.id).eq("fingerprint", episode.approval_fingerprint)
      .eq("decision", "approved").eq("youtube_public_consent", true).maybeSingle();
    if (consentError) throw new AppError("Falha ao conferir consentimento", 500, "DB_ERROR");
    if (!consent) continue;
    let release: (() => Promise<void>) | undefined;
    try {
      release = await claimEpisode(db, episode.id);
    } catch (error) {
      if (error instanceof AppError && error.code === "EPISODE_BUSY") continue;
      throw error;
    }
    try {
      const meta = (episode.metadata ?? {}) as Record<string, unknown>;
      const last = typeof meta.youtube_short_dispatch_at === "string" ? Date.parse(meta.youtube_short_dispatch_at) : NaN;
      const today = new Date().toISOString().slice(0, 10);
      const attempts = meta.youtube_short_dispatch_day === today && Number.isInteger(meta.youtube_short_dispatch_count)
        ? Number(meta.youtube_short_dispatch_count) : 0;
      if (attempts >= 3) continue;
      if (Number.isFinite(last) && Date.now() - last < 30 * 60_000) continue;
      const stamp = new Date().toISOString();
      const { data: reserved, error: reserveError } = await db.from("episodes")
        .update({ metadata: { ...meta, youtube_short_dispatch_at: stamp,
          youtube_short_dispatch_day: today, youtube_short_dispatch_count: attempts + 1 } })
        .eq("id", episode.id).eq("approval_fingerprint", episode.approval_fingerprint)
        .select("id").maybeSingle();
      if (reserveError) throw new AppError("Falha ao reservar publicação", 500, "DB_ERROR");
      if (!reserved) continue;
      await dispatchGithub("publish-youtube-shorts.yml", episode.id);
      await new JobLogger(db, "publication-dispatch").event({ episode_id: episode.id,
        event_type: "publish_started", metadata: { stage: "workflow_dispatch", platform: "youtube",
          variant: "portrait", privacy: "public", approval_fingerprint: episode.approval_fingerprint } });
      return { publication_dispatched: true, platform: "youtube", episode_id: episode.id };
    } finally { await release(); }
  }
  return null;
}
