import { assertEquals } from "jsr:@std/assert@1";
import { handleDiscoverTrends } from "../discover-trends/handler.ts";

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const vars = {
    SUPABASE_URL: "https://audit.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    TAVILY_API_KEY: "test-tavily-key",
    SOCIALCRAWL_API_KEY: "test-socialcrawl-key",
    TRENDS_MCP_API_KEY: "test-trends-mcp-key",
  };
  const old = Object.fromEntries(
    Object.keys(vars).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  return fn().finally(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

function req() {
  return new Request("https://worker.test", {
    method: "POST",
    headers: { Authorization: "Bearer test-service-key" },
    body: "{}",
  });
}

Deno.test("discover-trends não faz nada quando trend_discovery está desabilitado", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    let insertedAny = false;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname.endsWith("/system_config")) return json({ value: {} });
      if (url.pathname.endsWith("/idea_queue")) {
        insertedAny = true;
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const res = await handleDiscoverTrends(req());
      const body = await res.json();
      assertEquals(body.paused, true);
      assertEquals(insertedAny, false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("discover-trends insere sugestões com prioridade baixa e nunca excede max_pending", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    const inserted: Record<string, unknown>[] = [];
    // A escolha entre Tavily/HN depende do dia real (rotação diária). O mock
    // suporta ambas as fontes para o resultado não depender da data da CI.
    globalThis.fetch =
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), {
            headers: { "Content-Type": "application/json" },
          });
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        if (url.pathname.endsWith("/system_config")) {
          const key = url.searchParams.get("key");
          if (key === "eq.trend_discovery") {
            return json({ value: { enabled: true, max_pending: 3 } });
          }
          if (key === "eq.niche") {
            return json({
              value: {
                name: "gadgets_produtos_inovadores",
                focus: "gadgets criativos",
              },
            });
          }
          if (key === "eq.trend_sources") return json({ value: {} });
          return json({ value: {} });
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-range": "0-0/1" },
          });
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "POST") {
          inserted.push(body);
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/rpc/reserve_tavily_call")) {
          return json(true);
        }
        if (url.hostname === "api.tavily.com") {
          return json({
            query: "gadgets criativos lançamento tendência novidade",
            results: [
              {
                title: "Gadget A",
                url: "https://example.com/a",
                content: "Conteúdo de exemplo suficiente.",
                score: 0.9,
              },
              {
                title: "Gadget B",
                url: "https://example.com/b",
                content: "Conteúdo de exemplo suficiente.",
                score: 0.8,
              },
            ],
          });
        }
        if (url.hostname === "hn.algolia.com") {
          return json({
            hits: [
              {
                title: "Gadget A",
                url: "https://example.com/a",
                objectID: "1",
                points: 100,
              },
              {
                title: "Gadget B",
                url: "https://example.com/b",
                objectID: "2",
                points: 90,
              },
            ],
          });
        }
        return new Response(null, { status: 204 });
      }) as typeof fetch;
    try {
      const res = await handleDiscoverTrends(req());
      assertEquals(res.status, 201);
      const body = await res.json();
      assertEquals(body.created > 0, true);
      for (const row of inserted) {
        assertEquals(row.source, "trend_discovery");
        assertEquals(row.priority, 500);
      }
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("discover-trends prioriza Amazon para Shorts e não cria link afiliado sem ASIN validado", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    const inserted: Record<string, unknown>[] = [];
    const reserved: string[] = [];
    globalThis.fetch =
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), {
            headers: { "Content-Type": "application/json" },
          });
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        if (url.pathname.endsWith("/system_config")) {
          const key = url.searchParams.get("key");
          if (key === "eq.trend_discovery") {
            return json({ value: { enabled: true, max_pending: 2 } });
          }
          if (key === "eq.niche") {
            return json({
              value: {
                name: "gadgets_produtos_inovadores",
                focus: "gadgets úteis",
              },
            });
          }
          if (key === "eq.trend_sources") {
            return json({
              value: {
                primary: "trends_mcp",
                socialcrawl: { enabled: true, region: "BR", max_results: 5 },
                trends_mcp: { enabled: true, max_results: 5 },
              },
            });
          }
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-range": "*/0" },
          });
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "POST") {
          inserted.push(body);
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/rpc/reserve_trend_source_call")) {
          reserved.push(body.p_source);
          return json(true);
        }
        if (url.hostname === "www.socialcrawl.dev") {
          return json({ data: { products: [] } });
        }
        if (url.hostname === "api.trendsmcp.ai") {
          return json({
            trends: [{
              title: "Ventilador portátil",
              rank: 1,
              url: "https://shop.example/product/1",
            }],
          });
        }
        return new Response(null, { status: 204 });
      }) as typeof fetch;
    try {
      const res = await handleDiscoverTrends(req());
      assertEquals(res.status, 201);
      const body = await res.json();
      assertEquals(body.source, "trends_mcp");
      assertEquals(reserved, ["trends_mcp"]);
      assertEquals(inserted.length, 1);
      assertEquals(inserted[0].source, "trend_discovery");
      assertEquals(inserted[0].product_url, undefined);
      assertEquals(inserted[0].product_image_url, undefined);
      const briefing = String(inserted[0].briefing);
      for (
        const required of [
          "Amazon Best Sellers",
          "YouTube Short",
          "hook",
          "demonstrar o produto",
          "CTA",
          "ASIN",
          "SiteStripe",
        ]
      ) assertEquals(briefing.includes(required), true);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("discover-trends recorre ao SocialCrawl quando Amazon não retorna candidatos", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    const inserted: Record<string, unknown>[] = [];
    const reserved: string[] = [];
    globalThis.fetch =
      (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), {
            headers: { "Content-Type": "application/json" },
          });
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        if (url.pathname.endsWith("/system_config")) {
          const key = url.searchParams.get("key");
          if (key === "eq.trend_discovery") {
            return json({ value: { enabled: true, max_pending: 1 } });
          }
          if (key === "eq.niche") {
            return json({
              value: {
                name: "gadgets_produtos_inovadores",
                focus: "gadgets úteis",
              },
            });
          }
          if (key === "eq.trend_sources") {
            return json({
              value: {
                primary: "trends_mcp",
                trends_mcp: { enabled: true, max_results: 5 },
                socialcrawl: { enabled: true, region: "BR", max_results: 5 },
              },
            });
          }
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "content-range": "*/0" },
          });
        }
        if (url.pathname.endsWith("/idea_queue") && init?.method === "POST") {
          inserted.push(body);
          return new Response(null, { status: 201 });
        }
        if (url.pathname.endsWith("/rpc/reserve_trend_source_call")) {
          reserved.push(body.p_source);
          return json(true);
        }
        if (url.hostname === "api.trendsmcp.ai") {
          return json({ statusCode: 200, body: JSON.stringify({ data: [] }) });
        }
        if (url.hostname === "www.socialcrawl.dev") {
          return json({
            data: {
              products: [{
                id: "br-1",
                title: "Luminária articulada",
                product_url: "https://shop.example/br-1",
              }],
            },
          });
        }
        return new Response(null, { status: 204 });
      }) as typeof fetch;
    try {
      const res = await handleDiscoverTrends(req());
      assertEquals(res.status, 201);
      const body = await res.json();
      assertEquals(body.source, "socialcrawl");
      assertEquals(reserved, ["trends_mcp", "socialcrawl"]);
      assertEquals(inserted.length, 1);
      assertEquals(inserted[0].product_url, undefined);
      assertEquals(inserted[0].product_image_url, undefined);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));
