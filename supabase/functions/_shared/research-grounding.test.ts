import { assertEquals } from "jsr:@std/assert@1";
import { handleResearch } from "../generate-research/handler.ts";
import { researchMatchesEvidence } from "../../../packages/core/src/validators/research-evidence.ts";
import type { ResearchData } from "../../../packages/core/src/schemas/research.ts";

const source = { title: "Manual oficial", url: "https://example.com/manual", content: "O produto possui conexão USB, temporizador e ajuste de intensidade para uso em escritório.", score: 0.9 };
const research: ResearchData = [
  { claim: "O produto possui conexão USB.", source_url: source.url, confidence: 0.9, query_used: "conexão USB" },
  { claim: "O produto possui temporizador.", source_url: source.url, confidence: 0.9, query_used: "temporizador" },
  { claim: "O produto permite ajustar a intensidade.", source_url: source.url, confidence: 0.9, query_used: "ajuste de intensidade" },
];

async function scenario(options: { inventedUrl?: boolean; failSave?: boolean; stale?: boolean },
  verify: (result: { response: Response; episode: Record<string, unknown>; events: Array<Record<string, unknown>>;
    geminiCalls: number; geminiReserved: number; tavilyReserved: number }) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://research.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    GEMINI_API_KEY: "test-api-key", TAVILY_API_KEY: "tvly-test-key" };
  const savedEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const episode: Record<string, unknown> = { id: "11111111-1111-4111-8111-111111111111", status: "idea",
    briefing: { text: "Gadget com conexão USB e temporizador" } };
  const events: Array<Record<string, unknown>> = [];
  let geminiCalls = 0;
  let geminiReserved = 0;
  let tavilyReserved = 0;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.hostname === "api.tavily.com") {
      assertEquals(body.search_depth, "basic");
      assertEquals(body.include_raw_content, false);
      return json({ query: body.query, request_id: "req-test", results: [source], usage: { credits: 1 } });
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      geminiCalls++;
      assertEquals(body.tools, undefined);
      assertEquals(body.generationConfig.responseSchema.type, "ARRAY");
      const output = options.inventedUrl ? research.map((item, index) => index ? item : { ...item, source_url: "https://invented.test" }) : research;
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }], usageMetadata: { totalTokenCount: 100 } });
    }
    if (url.pathname.endsWith("/rpc/claim_episode")) return json(true);
    if (url.pathname.endsWith("/rpc/reserve_gemini_call")) { geminiReserved++; assertEquals(body.p_kind, "research"); return json(true); }
    if (url.pathname.endsWith("/rpc/reserve_tavily_call")) { tavilyReserved++; return json(true); }
    if (url.pathname.endsWith("/episode_leases") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/system_config")) return json({ value: {} });
    if (url.pathname.endsWith("/episodes")) {
      if (method === "PATCH") {
        assertEquals(url.searchParams.get("status"), "eq.idea");
        if (body.status === "research") {
          if (options.failSave) return json({ message: "Save unavailable" }, 500);
          if (options.stale) return json(null);
        }
        Object.assign(episode, body);
        return body.status === "research" ? json({ id: episode.id }) : new Response(null, { status: 204 });
      }
      return json(episode);
    }
    if (url.pathname.endsWith("/job_events")) { events.push(body); return new Response(null, { status: 201 }); }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    const response = await handleResearch(new Request("https://worker.test", { method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, body: JSON.stringify({ episode_id: episode.id }) }));
    await verify({ response, episode, events, geminiCalls, geminiReserved, tavilyReserved });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

Deno.test("research persiste busca, trechos e claims com URL encontrada", async () => {
  await scenario({}, async ({ response, episode, events, geminiCalls, geminiReserved, tavilyReserved }) => {
    assertEquals(response.status, 200);
    assertEquals(episode.status, "research");
    assertEquals(researchMatchesEvidence(episode.research_data as ResearchData, episode.research_evidence), true);
    assertEquals((episode.research_evidence as { provider: string }).provider, "tavily_search");
    assertEquals(geminiCalls, 1); assertEquals(geminiReserved, 1); assertEquals(tavilyReserved, 1);
    assertEquals(events.some(event => event.event_type === "tavily_call"), true);
  });
});

Deno.test("URL inventada pelo modelo reprova a evidência e nunca promove", async () => {
  await scenario({ inventedUrl: true }, async ({ response, episode }) => {
    assertEquals(response.status, 502);
    assertEquals((await response.json()).code, "RESEARCH_EVIDENCE_FAILED");
    assertEquals(episode.status, "failed");
    assertEquals(episode.failure_reason, "research_evidence_failed");
  });
});

Deno.test("falha de banco ou estado alterado não anuncia pesquisa concluída", async () => {
  for (const options of [{ failSave: true }, { stale: true }]) {
    await scenario(options, async ({ response, episode, events }) => {
      assertEquals(response.status, "failSave" in options ? 500 : 409);
      assertEquals(episode.status, "idea");
      assertEquals(episode.research_evidence, undefined);
      assertEquals(events.some(event => event.event_type === "research_completed"), false);
    });
  }
});
