import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { socialCrawlSearch } from "./socialcrawl.ts";
import { AppError } from "./error-handler.ts";

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const old = Deno.env.get("SOCIALCRAWL_API_KEY");
  Deno.env.set("SOCIALCRAWL_API_KEY", "test-socialcrawl-key");
  return fn().finally(() =>
    old === undefined
      ? Deno.env.delete("SOCIALCRAWL_API_KEY")
      : Deno.env.set("SOCIALCRAWL_API_KEY", old)
  );
}

Deno.test("SocialCrawl busca BR, valida HTTPS e normaliza candidatos", () =>
  withKey(async () => {
    const savedFetch = globalThis.fetch;
    let reserved = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assertEquals(url.searchParams.get("region"), "BR");
      assertEquals(url.searchParams.get("query"), "gadgets úteis");
      return new Response(
        JSON.stringify({
          data: {
            products: [
              {
                product_id: "p1",
                title: "Mini projetor",
                url: "https://shop.tiktok.com/view/product/p1",
                image_url: "https://img.example/p1.jpg",
              },
              {
                product_id: "p2",
                title: "URL insegura",
                url: "http://example.com/p2",
              },
            ],
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await socialCrawlSearch({
        query: "gadgets úteis",
        region: "br",
        maxResults: 5,
        beforeRequest: () => {
          reserved += 1;
          return Promise.resolve();
        },
      });
      assertEquals(reserved, 1);
      assertEquals(result.length, 2);
      assertEquals(
        result[0].productUrl,
        "https://shop.tiktok.com/view/product/p1",
      );
      assertEquals(result[1].productUrl, null);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("SocialCrawl rejeita payload fora do contrato", () =>
  withKey(async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: "invalid" }), {
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await assertRejects(
        () =>
          socialCrawlSearch({
            query: "gadget",
            region: "BR",
            maxResults: 5,
            beforeRequest: () =>
              Promise.resolve(),
          }),
        AppError,
        "resposta inválida",
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));
