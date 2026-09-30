import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { workerCredential } from "./auth.ts";
import { JobLogger } from "./logger.ts";
export async function discoverStudioDaily(db: SupabaseClient) {
  const { data: job, error } = await db.rpc("studio_claim_discovery");
  if (error || !job) return null;
  const logger = new JobLogger(db, "studio-daily-discovery");
  try {
    const key = workerCredential();
    if (!key) throw Error("Worker credential missing");
    const r = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/studio-discover`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(100000),
      },
    );
    if (!r.ok) throw Error(`Discovery HTTP ${r.status}`);
    const result = await r.json();
    let count = 0;
    for (const c of result.candidates || []) {
      const briefing =
        `Assunto específico: ${c.title}. Gancho: ${c.hook}. Abordagem: ${c.angle}. Por que agora: ${c.why_now}. Limitação: ${c.limitation}. Fonte para checagem: ${c.source_url}. Vídeo editorial com imagens licenciadas e CTA orgânico.`.slice(
          0,
          2000,
        );
      const { data, error } = await db.rpc("studio_command", {
        p_workspace: job.workspace,
        p_actor: job.actor,
        p_request: crypto.randomUUID(),
        p_action: "candidate",
        p_payload: {
          briefing,
          discovery_id: result.id,
          candidate: c,
          profile: result.profile,
        },
      });
      if (!error && data?.code === "created") count++;
    }
    return { studio_discovery: true, candidates: count };
  } catch (e) {
    logger.error("Pesquisa diária não concluída; próxima tentativa amanhã", e);
    return { studio_discovery: false };
  }
}
