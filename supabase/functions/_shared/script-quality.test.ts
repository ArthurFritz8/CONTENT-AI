import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { makeValidScript } from "../../../packages/core/src/testing/script-fixture.ts";
import { makeResearchEvidence } from "../../../packages/core/src/testing/research-fixture.ts";
import { handleScript } from "../generate-script/handler.ts";
import { handleAssets } from "../generate-assets/handler.ts";

const policy = { blocked_patterns: { medical: ["\\mcura\\M"] }, require_source_per_claim: true };

async function scenario(options: {
  replies?: unknown[]; config?: unknown; stage?: "script" | "assets";
  failAudit?: boolean; changeState?: boolean; editedScript?: boolean;
  missingEvidence?: boolean; changedResearch?: boolean;
}, verify: (result: {
  response: Response; episode: Record<string, unknown>; events: Array<Record<string, unknown>>;
  calls: number; reservations: number; prompts: string[];
}) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://quality.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", GEMINI_API_KEY: "test-api-key" };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const script = makeValidScript();
  if (options.editedScript) script.metadata.youtube.title = "Cura tudo";
  const episode: Record<string, unknown> = {
    id: script.episode_id, status: options.stage === "assets" ? "script" : "research",
    briefing: { text: "Um gadget útil" }, product_compliance: { commercial_content: false },
    script_json: script,
    research_data: script.sources.map(source => ({ ...source, confidence: 0.9, query_used: "produto" })),
  };
  episode.research_evidence = options.missingEvidence ? null : makeResearchEvidence(
    script.sources.map(source => ({ ...source, confidence: 0.9, query_used: "produto" })));
  if (options.changedResearch) episode.research_data = script.sources.map(source => ({ ...source, claim: "Pesquisa alterada", confidence: 0.9, query_used: "produto" }));
  const events: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  let calls = 0;
  let reservations = 0;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.hostname === "generativelanguage.googleapis.com") {
      prompts.push(body.contents[0].parts[0].text);
      const reply = options.replies?.[calls] ?? script;
      calls++;
      return json({ candidates: [{ content: { parts: [{ text: typeof reply === "string" ? reply : JSON.stringify(reply) }] } }] });
    }
    if (url.pathname.endsWith("/rpc/claim_episode")) return json(true);
    if (url.pathname.endsWith("/rpc/reserve_gemini_call")) { reservations++; return json(true); }
    if (url.pathname.endsWith("/episode_leases") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/episodes")) {
      if (method === "PATCH") {
        assertEquals(url.searchParams.get("status"), options.stage === "assets" ? "eq.script" : "eq.research");
        if (options.changeState) return json(null);
        Object.assign(episode, body);
        return body.status === "script" ? json({ id: script.episode_id }) : new Response(null, { status: 204 });
      }
      return json(episode);
    }
    if (url.pathname.endsWith("/system_config")) {
      if (url.searchParams.get("key") === "eq.fact_check") return json({ value: "config" in options ? options.config : policy });
      return json({ value: {} });
    }
    if (url.pathname.endsWith("/prompt_versions")) return json({ version: "1.0.0" });
    if (url.pathname.endsWith("/job_events") && method === "POST") {
      if (options.failAudit && ["qa_passed", "qa_failed"].includes(body.event_type)) return json({ message: "db unavailable" }, 500);
      events.push(body);
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const req = new Request("https://worker.test", { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify({ episode_id: script.episode_id }) });
    const response = await (options.stage === "assets" ? handleAssets : handleScript)(req);
    await verify({ response, episode, events, calls, reservations, prompts });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

Deno.test("QA corrige fonte inventada em um repair, mantém pesquisa no prompt e audita os dois resultados", async () => {
  const invalid = makeValidScript();
  invalid.sources[0]!.source_url = "https://inventada.test";
  await scenario({ replies: [invalid, makeValidScript()] }, async ({ response, episode, events, calls, reservations, prompts }) => {
    assertEquals(response.status, 200);
    assertEquals(episode.status, "script");
    assertEquals(calls, 2);
    assertEquals(reservations, 2);
    assertStringIncludes(prompts[1]!, "https://example.com/fonte");
    assertStringIncludes(prompts[1]!, "Copie o par claim/source_url");
    assertEquals(events.filter(e => String(e.event_type).startsWith("qa_")).map(e => e.event_type), ["qa_failed", "qa_passed"]);
    const metadata = episode.metadata as { script_qa: { passed: boolean; factual_verification: string } };
    assertEquals(metadata.script_qa.passed, true);
    assertEquals(metadata.script_qa.factual_verification, "requires_human_review");
    assertEquals(episode.qa_score, undefined);
  });
});

Deno.test("QA persistente reprova após duas chamadas e não avança a assets", async () => {
  const invalid = makeValidScript();
  invalid.metadata.youtube.title = "Cura qualquer problema";
  await scenario({ replies: [invalid, invalid] }, async ({ response, episode, calls, events }) => {
    assertEquals(response.status, 502);
    assertEquals((await response.json()).code, "SCRIPT_QUALITY_FAILED");
    assertEquals(episode.status, "failed");
    assertEquals(episode.failure_reason, "script_quality_failed");
    assertEquals(calls, 2);
    assertEquals(events.filter(e => e.event_type === "qa_failed").length, 2);
  });
});

Deno.test("JSON malformado ainda usa o único repair e depois passa pelo QA", async () => {
  await scenario({ replies: ["{invalid", makeValidScript()] }, async ({ response, episode, calls, events }) => {
    assertEquals(response.status, 200);
    assertEquals(calls, 2);
    assertEquals(episode.status, "script");
    assertEquals(events.filter(e => e.event_type === "qa_passed").length, 1);
  });
});

Deno.test("repair que quebra JSON reporta falha estrutural sem reutilizar relatório anterior", async () => {
  const invalid = makeValidScript();
  invalid.metadata.youtube.title = "Cura tudo";
  await scenario({ replies: [invalid, "{invalid"] }, async ({ response, episode, calls }) => {
    assertEquals(response.status, 502);
    assertEquals((await response.json()).code, "JSON_VALIDATION_FAILED");
    assertEquals(episode.failure_reason, "json_validation_failed");
    assertEquals(calls, 2);
  });
});

Deno.test("QA config ausente ou inválida não gasta quota nem muda estado", async () => {
  for (const config of [null, {}, { ...policy, blocked_patterns: { medical: ["(a+)+$"] } }]) {
    await scenario({ config }, async ({ response, episode, calls, reservations }) => {
      assertEquals(response.status, 500);
      assertEquals((await response.json()).code, "QA_CONFIG_INVALID");
      assertEquals(calls, 0);
      assertEquals(reservations, 0);
      assertEquals(episode.status, "research");
    });
  }
});

Deno.test("falha na persistência do QA não declara script gerado nem muda o estado", async () => {
  await scenario({ failAudit: true }, async ({ response, episode, calls }) => {
    assertEquals(response.status, 500);
    assertEquals((await response.json()).code, "DB_ERROR");
    assertEquals(calls, 1);
    assertEquals(episode.status, "research");
  });
});

Deno.test("mudança de estado durante geração não retorna sucesso falso", async () => {
  await scenario({ changeState: true }, async ({ response, events }) => {
    assertEquals(response.status, 409);
    assertEquals(events.some(e => e.event_type === "script_generated"), false);
  });
});

Deno.test("assets revalida roteiro editado antes de qualquer imagem/TTS/storage", async () => {
  await scenario({ stage: "assets", editedScript: true }, async ({ response, episode, calls, events }) => {
    assertEquals(response.status, 422);
    assertEquals(episode.status, "failed");
    assertEquals(episode.failure_reason, "script_quality_failed");
    assertEquals(calls, 0);
    assertEquals(events.some(e => e.event_type === "qa_failed"), true);
  });
});

Deno.test("assets mantém checkpoint quando configuração QA está inválida", async () => {
  await scenario({ stage: "assets", config: null }, async ({ response, episode, calls }) => {
    assertEquals(response.status, 500);
    assertEquals(episode.status, "script");
    assertEquals(calls, 0);
  });
});

Deno.test("pesquisa sem evidência ou editada bloqueia script e assets antes de providers", async () => {
  for (const stage of ["script", "assets"] as const) {
    for (const option of [{ missingEvidence: true }, { changedResearch: true }]) {
      await scenario({ stage, ...option }, async ({ response, episode, calls, reservations }) => {
        assertEquals(response.status, 422);
        assertEquals((await response.json()).code, "RESEARCH_EVIDENCE_INVALID");
        assertEquals(episode.status, "failed");
        assertEquals(episode.failure_reason, "research_evidence_invalid");
        assertEquals(calls, 0);
        assertEquals(reservations, 0);
      });
    }
  }
});
