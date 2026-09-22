import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { trendsMcpHotProducts } from "./trends-mcp.ts";
import { AppError } from "./error-handler.ts";

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const old = Deno.env.get("TRENDS_MCP_API_KEY");
  Deno.env.set("TRENDS_MCP_API_KEY", "test-trends-key");
  return fn().finally(() =>
    old === undefined
      ? Deno.env.delete("TRENDS_MCP_API_KEY")
      : Deno.env.set("TRENDS_MCP_API_KEY", old)
  );
}

Deno.test("Trends MCP envia get_top_trends e normaliza o ranking", () =>
  withKey(async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch =
      (async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        assertEquals(body.mode, "get_top_trends");
        assertEquals(body.type, "TikTok Shop Hot Products");
        return new Response(
          JSON.stringify({
            trends: [
              {
                title: "Ventilador portátil",
                rank: 1,
                url: "https://example.com/fan",
              },
              { name: "Teclado mecânico", rank: 2, url: "javascript:alert(1)" },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;
    try {
      const result = await trendsMcpHotProducts({
        maxResults: 5,
        beforeRequest: () => Promise.resolve(),
      });
      assertEquals(result, [
        {
          title: "Ventilador portátil",
          rank: 1,
          url: "https://example.com/fan",
        },
        { title: "Teclado mecânico", rank: 2, url: null },
      ]);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("Trends MCP propaga falha HTTP sem expor resposta", () =>
  withKey(async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("secret upstream body", { status: 401 })) as typeof fetch;
    try {
      await assertRejects(
        () =>
          trendsMcpHotProducts({
            maxResults: 5,
            beforeRequest: () =>
              Promise.resolve(),
          }),
        AppError,
        "Trends MCP falhou (401)",
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));
