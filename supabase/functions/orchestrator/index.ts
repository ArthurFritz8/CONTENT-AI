// orchestrator — consome idea_queue e cria episódios respeitando o cap diário (ADR-007).
// Sem input: disparado pelo pg_cron diário; consumo atômico via RPC consume_next_idea.

import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";

interface PipelineConfig {
  max_episodes_per_day?: number;
}

interface ConsumeResult {
  episode_id: string;
  idea_id: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let logger: JobLogger | undefined;
  try {
    const db = createServiceClient();
    logger = new JobLogger(db, "orchestrator");

    const cfg = await getSystemConfig<PipelineConfig>(db, "pipeline", {});
    const maxPerDay = cfg.max_episodes_per_day ?? 1;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await db
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());
    if (countError) {
      throw new AppError(`Erro ao contar episódios do dia: ${countError.message}`, 500, "DB_ERROR");
    }

    if ((count ?? 0) >= maxPerDay) {
      logger.info("cap diário atingido — nenhuma ideia consumida", { count, maxPerDay });
      return jsonResponse({ created: false, reason: "daily_cap_reached", count, maxPerDay });
    }

    const { data, error } = await db.rpc("consume_next_idea");
    if (error) {
      throw new AppError(`consume_next_idea falhou: ${error.message}`, 500, "DB_ERROR");
    }
    const row = (Array.isArray(data) ? data[0] : data) as ConsumeResult | undefined;
    if (!row) {
      logger.info("fila de ideias vazia");
      return jsonResponse({ created: false, reason: "idea_queue_empty" });
    }

    await logger.event({
      episode_id: row.episode_id,
      event_type: "state_transition",
      metadata: { to: "idea", idea_id: row.idea_id, source: "idea_queue" },
    });
    logger.info("episódio criado a partir da fila", { ...row });

    return jsonResponse({ created: true, ...row }, 201);
  } catch (err) {
    logger?.error("falha no orchestrator", err);
    return toErrorResponse(err);
  }
});
