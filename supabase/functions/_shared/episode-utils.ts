import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JobLogger } from "./logger.ts";

/** Marca episódio como failed com razão auditável (DRY entre Edge Functions). */
export async function markEpisodeFailed(
  db: SupabaseClient,
  logger: JobLogger,
  episodeId: string,
  reason: string,
  errorMessage?: string,
  expectedStatus?: string,
): Promise<void> {
  let query = db
    .from("episodes")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", episodeId);
  if (expectedStatus) query = query.eq("status", expectedStatus);
  const { error } = await query;
  if (error) logger.error("falha ao marcar episódio como failed", error, { episodeId });

  await logger.event({
    episode_id: episodeId,
    event_type: "failed",
    error_message: errorMessage ?? reason,
    metadata: { reason },
  });
}
