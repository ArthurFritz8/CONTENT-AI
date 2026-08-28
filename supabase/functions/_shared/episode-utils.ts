import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JobLogger } from "./logger.ts";

/** Marca episódio como failed com razão auditável (DRY entre Edge Functions). */
export async function markEpisodeFailed(
  db: SupabaseClient,
  logger: JobLogger,
  episodeId: string,
  reason: string,
  errorMessage?: string,
): Promise<void> {
  const { error } = await db
    .from("episodes")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", episodeId);
  if (error) logger.error("falha ao marcar episódio como failed", error, { episodeId });

  await logger.event({
    episode_id: episodeId,
    event_type: "failed",
    error_message: errorMessage ?? reason,
    metadata: { reason },
  });
}
