import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { claimEpisode } from "./episode-lease.ts";
import { dispatchGithub } from "./github-dispatch.ts";

/** One bounded step per tick. Resuming existing work precedes consuming another idea. */
export async function advancePipeline(db: SupabaseClient): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from("episodes").select("id,status,tts_engine,metadata")
    .in("status", ["idea", "research", "script", "assets", "rendered"]).order("updated_at").limit(1);
  if (error) throw new AppError("Erro ao selecionar trabalho", 500, "DB_ERROR");
  const episode = data?.[0];
  if (!episode) return null;
  if (episode.status === "rendered") {
    const { error: updateError } = await db.from("episodes").update({ status: "review" }).eq("id", episode.id).eq("status", "rendered");
    if (updateError) throw new AppError("Erro ao solicitar revisão", 500, "DB_ERROR");
    return { episode_id: episode.id, status: "review", human_review_required: true };
  }
  if (episode.status === "script" && ["edge", "piper"].includes(episode.tts_engine)) {
    const release = await claimEpisode(db, episode.id);
    try {
      const { data: fresh, error: readError } = await db.from("episodes").select("metadata").eq("id", episode.id).single();
      if (readError) throw new AppError("Erro ao ler dispatch", 500, "DB_ERROR");
      const previous = fresh.metadata?.assets_dispatch_at;
      if (previous && Date.now() - Date.parse(previous) < 20 * 60_000) return { episode_id: episode.id, waiting_for_runner: true };
      const attempt = Number(fresh.metadata?.assets_dispatch_attempt ?? 0) + 1;
      if (attempt > 3) {
        const { error: failError } = await db.from("episodes").update({ status: "failed", failure_reason: "assets_runner_attempts_exhausted" }).eq("id", episode.id).eq("status", "script");
        if (failError) throw new AppError("Falha ao encerrar tentativas", 500, "DB_ERROR");
        return { episode_id: episode.id, failed: true };
      }
      const { error: writeError } = await db.from("episodes").update({ metadata: { ...fresh.metadata, assets_dispatch_at: new Date().toISOString(), assets_dispatch_attempt: attempt } }).eq("id", episode.id).eq("status", "script");
      if (writeError) throw new AppError("Erro ao reservar dispatch", 500, "DB_ERROR");
      await dispatchGithub("assets.yml", episode.id);
      return { episode_id: episode.id, assets_dispatched: true };
    } finally { await release(); }
  }
  const next: Record<string, string> = { idea: "generate-research", research: "generate-script", script: "generate-assets", assets: "trigger-render" };
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${next[episode.status]}`, {
    method: "POST", signal: AbortSignal.timeout(130_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ episode_id: episode.id }),
  });
  if (!res.ok && res.status !== 409) throw new AppError(`Etapa ${next[episode.status]} respondeu ${res.status}`, 502, "STAGE_FAILED");
  return { episode_id: episode.id, step: next[episode.status], http_status: res.status };
}
