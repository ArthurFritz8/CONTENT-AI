import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { JobEventInsert } from "./types.ts";

/**
 * Logger estruturado (Regra D): eventos de negócio vão para job_events;
 * console.* só existe aqui dentro, em JSON estruturado para os logs da Edge Function.
 */
export class JobLogger {
  constructor(
    private readonly db: SupabaseClient,
    private readonly fn: string,
  ) {}

  info(msg: string, extra?: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: "info", fn: this.fn, msg, ...extra }));
  }

  error(msg: string, err?: unknown, extra?: Record<string, unknown>): void {
    console.error(JSON.stringify({
      level: "error",
      fn: this.fn,
      msg,
      error: err instanceof Error ? err.message : String(err ?? ""),
      ...extra,
    }));
  }

  /** Grava evento auditável em job_events; falha de log nunca derruba o fluxo principal. */
  async event(e: JobEventInsert): Promise<void> {
    const { error } = await this.db.from("job_events").insert(e);
    if (error) {
      this.error("falha ao gravar job_event", error, { event_type: e.event_type });
    }
  }
}
