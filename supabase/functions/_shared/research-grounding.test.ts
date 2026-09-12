import { assertEquals } from "jsr:@std/assert@1";
import { handleResearch } from "../generate-research/handler.ts";
import { makeResearchEvidence } from "../../../packages/core/src/testing/research-fixture.ts";
import { researchMatchesEvidence } from "../../../packages/core/src/validators/research-evidence.ts";
import type { ResearchData } from "../../../packages/core/src/schemas/research.ts";

async function scenario(options: { noGrounding?: boolean; partial?: boolean; failSave?: boolean; stale?: boolean; thoughts?: boolean },
  verify: (result: { response: Response; episode: Record<string, unknown>; events: Array<Record<string, unknown>>; calls: number; reserved: number }) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://grounding.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", GEMINI_API_KEY: "test-api-key" };
  const savedEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const episode: Record<string, unknown> = { id: "11111111-1111-4111-8111-111111111111", status: "idea", briefing: { text: "Gadget com conexão USB" } };
  const research = [{ claim: "Conexão USB disponível 🔌", source_url: "https://example.com/model-url", confidence: 0.9, query_used: "conexão USB" }];
  const evidence = makeResearchEvidence(research);
  evidence.grounding_metadata.groundingChunks[0]!.web!.uri = "https://example.com/provider-citation";
  if (options.partial) evidence.grounding_metadata.groundingSupports = [];
  const parts: Array<{ text: string; thought?: boolean }> = [{ text: evidence.parts[0]! }];
  if (options.thoughts) {
    parts.unshift({ text: "Internal thought is not the research JSON", thought: true });
    for (const support of evidence.grounding_metadata.groundingSupports) support.segment.partIndex = 1;
  }
  const events: Array<Record<string, unknown>> = [];
  let calls = 0;
  let reserved = 0;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.hostname === "generativelanguage.googleapis.com") {
      calls++;
      assertEquals(body.tools, [{ google_search: {} }]);
      assertEquals(body.generationConfig.responseSchema, undefined);
      return json({ candidates: [{ content: { parts }, ...(!options.noGrounding ? { groundingMetadata: evidence.grounding_metadata } : {}) }] });
    }
    if (url.pathname.endsWith("/rpc/claim_episode")) return json(true);
    if (url.pathname.endsWith("/rpc/reserve_gemini_call")) { reserved++; return json(true); }
    if (url.pathname.endsWith("/episode_leases") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/system_config")) return json({ value: {} });
    if (url.pathname.endsWith("/episodes")) {
      if (method === "PATCH") {
        assertEquals(url.searchParams.get("status"), "eq.idea");
        if (body.status === "research") {
          assertEquals(!!body.research_data && !!body.research_evidence, true);
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
    await verify({ response, episode, events, calls, reserved });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

Deno.test("research persiste citações e dados juntos, usando URL do provedor", async () => {
  await scenario({}, async ({ response, episode, calls, reserved }) => {
    assertEquals(response.status, 200);
    assertEquals(episode.status, "research");
    assertEquals((episode.research_data as ResearchData)[0]!.source_url, "https://example.com/provider-citation");
    assertEquals(researchMatchesEvidence(episode.research_data as ResearchData, episode.research_evidence), true);
    assertEquals(calls, 1);
    assertEquals(reserved, 1);
  });
});

Deno.test("research sem grounding completo falha uma vez e nunca promove", async () => {
  for (const options of [{ noGrounding: true }, { partial: true }]) {
    await scenario(options, async ({ response, episode, calls, reserved, events }) => {
      assertEquals(response.status, 502);
      assertEquals((await response.json()).code, "RESEARCH_GROUNDING_FAILED");
      assertEquals(episode.status, "failed");
      assertEquals(episode.failure_reason, "research_grounding_failed");
      assertEquals(calls, 1);
      assertEquals(reserved, 1);
      assertEquals(events.some(event => event.event_type === "research_completed"), false);
    });
  }
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

Deno.test("pensamentos não entram no JSON nem no snapshot, preservando partIndex", async () => {
  await scenario({ thoughts: true }, async ({ response, episode }) => {
    assertEquals(response.status, 200);
    const snapshot = episode.research_evidence as { parts: Array<string | null> };
    assertEquals(snapshot.parts[0], null);
    assertEquals(snapshot.parts.length, 2);
    assertEquals(researchMatchesEvidence(episode.research_data as ResearchData, snapshot), true);
  });
});
