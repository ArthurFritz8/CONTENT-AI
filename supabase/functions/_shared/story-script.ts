import { buildStoryScript, fictionPlanMatches } from "../../../packages/core/src/stories/script.ts";
import { storyContextSchema } from "../../../packages/core/src/stories/schema.ts";
import { chapterPrompt } from "../../../packages/core/src/stories/prompts.ts";
import { computeScriptHash } from "../../../packages/core/src/validators/hash-utils.ts";
import { extractJson } from "./gemini.ts";
import { writeStory } from "./story-writer.ts";
import { AppError, jsonResponse } from "./error-handler.ts";
import { createServiceClient } from "./supabase-client.ts";
import { loadScriptQualityChecker, recordScriptQuality } from "./script-quality.ts";
import { markEpisodeFailed } from "./episode-utils.ts";
import type { JobLogger } from "./logger.ts";

export async function generateStoryScript(db: ReturnType<typeof createServiceClient>, logger: JobLogger,
  episode: { id: string; briefing: { story_context: unknown }; research_evidence: unknown }): Promise<Response> {
  const context = storyContextSchema.parse(episode.briefing.story_context);
  if (!fictionPlanMatches(context, episode.research_evidence)) throw new AppError("Plano narrativo alterado", 422, "RESEARCH_EVIDENCE_INVALID");
  const quality = await loadScriptQualityChecker(db);
  let errors = "";
  for (const attempt of [1, 2]) {
    const result = await writeStory(db, logger, `${chapterPrompt(context)}${errors ? `\nCorrija: ${errors}` : ""}`, episode.id);
    let script;
    try { script = buildStoryScript(extractJson(result.text), context, episode.id); }
    catch (e) { errors = e instanceof Error ? e.message.slice(0, 1200) : "JSON inválido"; continue; }
    const hash = await computeScriptHash(script), report = quality.check(script, [], false);
    await recordScriptQuality(db, episode.id, report, { stage: "generate-script", script_hash: hash, policy_hash: quality.policy_hash, attempt });
    if (!report.passed) { errors = report.findings.filter(f => f.severity === "error").map(f => f.message).join("; "); continue; }
    const { data, error } = await db.from("episodes").update({ status: "script", script_json: script, script_hash: hash,
      prompt_version: script.prompt_version, metadata: { ...script.metadata, editorial_style: script.editorial_style,
        script_qa: { ...report, policy_hash: quality.policy_hash, script_hash: hash } } }).eq("id", episode.id).eq("status", "research").select("id").maybeSingle();
    if (error) {
      if (error.code === "23505") {
        await markEpisodeFailed(db, logger, episode.id, "duplicate_script", "Roteiro já existe", "research");
        throw new AppError("Roteiro duplicado detectado",409,"DUPLICATE_SCRIPT");
      }
      throw new AppError("Falha ao salvar roteiro", 500, "DB_ERROR");
    }
    if (!data) throw new AppError("Estado alterado", 409, "INVALID_STATE");
    await logger.event({ episode_id: episode.id, event_type: "script_generated", model_used: result.model, cost_estimate: 0,
      metadata: { type: "original_fiction", series_id: context.series_id, chapter_number: context.chapter_number, attempts: attempt, scenes: script.scenes.length, script_hash: hash } });
    return jsonResponse({ episode_id: episode.id, script_hash: hash, scenes: script.scenes.length });
  }
  await markEpisodeFailed(db, logger, episode.id, "script_quality_failed", errors.slice(0, 1000), "research");
  throw new AppError("Roteiro de ficção reprovado após correção", 422, "SCRIPT_QUALITY_FAILED");
}
