import { assertEquals } from "jsr:@std/assert@1";
import { hackerNewsSearch } from "./hackernews.ts";

Deno.test("hackerNewsSearch filtra itens sem título/url e limita ao maxResults", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      hits: [
        { title: "Gadget incrível", url: "https://example.com/a", objectID: "1", points: 120 },
        { title: null, url: "https://example.com/b", objectID: "2", points: 50 },
        { title: "Sem URL", url: null, objectID: "3", points: 10 },
        { title: "URL insegura", url: "http://example.com/c", objectID: "4", points: 5 },
        { title: "Segundo gadget", url: "https://example.com/d", objectID: "5", points: 80 },
      ],
    }), { headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    const items = await hackerNewsSearch({ query: "gadget", maxResults: 1 });
    assertEquals(items.length, 1);
    assertEquals(items[0]?.title, "Gadget incrível");
    assertEquals(items[0]?.url, "https://example.com/a");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

Deno.test("hackerNewsSearch propaga erro em resposta HTTP não-ok", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("erro", { status: 500 })) as typeof fetch;
  try {
    let threw = false;
    try {
      await hackerNewsSearch({ query: "gadget", maxResults: 5 });
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    globalThis.fetch = savedFetch;
  }
});
