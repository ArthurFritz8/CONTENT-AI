import { z } from "zod";
import { requireServiceRole } from "../_shared/auth.ts";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { writeStory } from "../_shared/story-writer.ts";
import { extractJson } from "../_shared/gemini.ts";
import { getGeminiBudgetRemaining } from "../_shared/budget-guard.ts";
import { storyRequestSchema, seriesBibleSchema } from "../../../packages/core/src/stories/schema.ts";
import { biblePrompt } from "../../../packages/core/src/stories/prompts.ts";

const base = { workspace: z.string().uuid(), actor: z.string().uuid() };
const schema = z.discriminatedUnion("action", [z.object({ ...base, action: z.literal("capacity") }),
  z.object({ ...base, action: z.literal("propose"), request_id: z.string().uuid(), input: storyRequestSchema })]);
Deno.serve(async req => {
  let logger: JobLogger | undefined;
  try {
    requireServiceRole(req);
    if (req.method !== "POST") throw new AppError("Método inválido", 405, "METHOD_NOT_ALLOWED");
    const input = await parseJsonBody(req, schema), db = createServiceClient();
    logger = new JobLogger(db, "studio-story");
    const { error: auth } = await db.rpc("studio_assert_member", { p_workspace: input.workspace, p_actor: input.actor });
    if (auth) throw new AppError("Acesso negado", 403, "FORBIDDEN");
    if (input.action === "capacity") {
      const cfg = await getSystemConfig<{ text_model?: string }>(db, "gemini", {}), model = cfg.text_model ?? "gemini-3.6-flash";
      const budget = await getSystemConfig<{ gemini_models?: Record<string, { rpd?: number }> }>(db, "budget", {});
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const { data: modelUsage, error } = await db.from("api_budget_usage").select("used").eq("scope", `gemini:model:${model}`).eq("period", day).maybeSingle();
      if (error) throw new AppError("Falha ao consultar consumo", 500, "DB_ERROR");
      const gemini = Deno.env.get("GEMINI_API_KEY") ? Math.min(await getGeminiBudgetRemaining(db, "text"),
        Math.max(0,(budget.gemini_models?.[model]?.rpd ?? 0)-(modelUsage?.used ?? 0))) : 0;
      let alternative = 0;
      const key = Deno.env.get("OPENROUTER_API_KEY");
      if (key) {
        try {
          const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
          if (res.ok) {
            const cfg = await getSystemConfig<{ openrouter_daily_cap?: number }>(db, "story_production", {});
            const { data: usage } = await db.from("api_budget_usage").select("used").eq("scope", "story:openrouter").eq("period", new Date().toISOString().slice(0,10)).maybeSingle();
            const account = (await res.json()).data?.free_model_daily_requests?.remaining;
            if (typeof account === "number") alternative = Math.min(Math.max(0,account),Math.max(0,Math.min(50,cfg.openrouter_daily_cap ?? 0)-(usage?.used ?? 0)));
          }
        } catch { /* Unknown provider balance contributes zero; never invent capacity. */ }
      }
      return jsonResponse({ estimated_script_capacity: Math.floor((gemini + alternative)/2), illustration: "own", animated_available: false,
        estimate: true, checked_at: new Date().toISOString() });
    }
    const { data: claim, error } = await db.rpc("studio_story_claim", { p_workspace: input.workspace, p_actor: input.actor, p_request: input.request_id, p_input: input.input });
    if (error) throw new AppError("Não foi possível reservar proposta", 500, "DB_ERROR");
    if (claim.code === "saved") return jsonResponse(claim);
    if (claim.code !== "claimed") throw new AppError(claim.code === "busy" ? "A proposta ainda está sendo criada. Aguarde antes de tentar novamente." : "Limite de propostas atingido", claim.code === "busy" ? 409 : 429, "STORY_LIMIT");
    let correction = "";
    for (const attempt of [1,2]) {
      const result = await writeStory(db, logger, `${biblePrompt(input.input)}\n${correction}`);
      let parsed;
      try { parsed = seriesBibleSchema.safeParse(extractJson(result.text)); }
      catch { correction = "Retorne apenas um objeto JSON válido."; continue; }
      if (!parsed.success || parsed.data.kind !== input.input.kind || parsed.data.genre !== input.input.genre || parsed.data.chapters.length !== input.input.chapters) {
        correction = `Corrija o formato: ${parsed.success ? "tipo, gênero e quantidade de capítulos devem corresponder ao pedido" : parsed.error.message.slice(0,1000)}`;
        continue;
      }
      const { data: sid, error: save } = await db.rpc("studio_story_save", { p_workspace: input.workspace, p_actor: input.actor, p_request: input.request_id, p_bible: parsed.data });
      if (save) throw new AppError("Falha ao guardar proposta", 500, "DB_ERROR");
      return jsonResponse({ code: "saved", series_id: sid });
    }
    throw new AppError("A proposta não passou na validação. Tente novamente mais tarde.", 422, "STORY_INVALID");
  } catch (e) { logger?.error("Falha na proposta de história", e); return toErrorResponse(e); }
});
