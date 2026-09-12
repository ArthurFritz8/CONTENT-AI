import { createScriptQualityChecker } from "../../../packages/core/src/validators/script-quality.ts";
import type { ScriptQualityReport } from "../../../packages/core/src/validators/script-quality.ts";
import { canonicalStringify, sha256Hex } from "../../../packages/core/src/validators/hash-utils.ts";
import { createServiceClient, getSystemConfig } from "./supabase-client.ts";
import { AppError } from "./error-handler.ts";

export async function loadScriptQualityChecker(db: ReturnType<typeof createServiceClient>) {
  const config = await getSystemConfig<unknown>(db, "fact_check", null);
  try {
    return { check: createScriptQualityChecker(config), policy_hash: await sha256Hex(canonicalStringify(config)) };
  } catch {
    throw new AppError("system_config.fact_check ausente ou inválido; revise os padrões e require_source_per_claim", 500, "QA_CONFIG_INVALID");
  }
}

/** Quality reports are required evidence, not best-effort diagnostic logs. */
export async function recordScriptQuality(
  db: ReturnType<typeof createServiceClient>, episodeId: string, report: ScriptQualityReport,
  context: { stage: "generate-script" | "generate-assets"; script_hash: string; policy_hash: string; attempt?: number },
): Promise<void> {
  const { error } = await db.from("job_events").insert({
    episode_id: episodeId, event_type: report.passed ? "qa_passed" : "qa_failed",
    cost_estimate: 0, metadata: { scope: "script_deterministic", ...context, report },
  });
  if (error) throw new AppError("Erro ao persistir relatório de qualidade", 500, "DB_ERROR");
}
