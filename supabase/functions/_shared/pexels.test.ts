import { assertEquals } from "jsr:@std/assert@1";
import { searchPexelsPhotos } from "./pexels.ts";

Deno.test("Pexels busca candidatos com metadados úteis sem usar imagem da primeira posição cegamente", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = Deno.env.get("PEXELS_API_KEY");
  Deno.env.set("PEXELS_API_KEY", "test-only");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEquals(url.searchParams.get("query"), "compact desk device");
    assertEquals(url.searchParams.get("per_page"), "12");
    return new Response(JSON.stringify({ photos: [{ id: 42, url: "https://www.pexels.com/photo/42/",
      photographer: "Creator", alt: "Compact device on desk",
      src: { landscape: "https://images.pexels.com/42-wide.jpg", portrait: "https://images.pexels.com/42-tall.jpg" } }] }),
      { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const photos = await searchPexelsPhotos("compact desk device");
    assertEquals(photos[0]?.id, 42);
    assertEquals(photos[0]?.alt, "Compact device on desk");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) Deno.env.delete("PEXELS_API_KEY"); else Deno.env.set("PEXELS_API_KEY", oldKey);
  }
});
