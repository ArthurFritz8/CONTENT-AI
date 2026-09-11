import { AppError } from "./error-handler.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function claimEpisode(db: SupabaseClient, episodeId: string): Promise<() => Promise<void>> {
  const token = crypto.randomUUID();
  const { data, error } = await db.rpc("claim_episode", { p_id: episodeId, p_token: token });
  if (error) throw new AppError("Erro ao adquirir execução do episódio", 500, "DB_ERROR");
  if (!data) throw new AppError("Episódio já em processamento", 409, "EPISODE_BUSY");
  return async () => {
    // A stale worker cannot release a newer worker's lease.
    await db.from("episode_leases").delete().eq("episode_id", episodeId).eq("token", token);
  };
}
