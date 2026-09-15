import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";
import { createServiceClient } from "./supabase-client.ts";
import { JobLogger } from "./logger.ts";
import { ensureSpokesmodelReference, generatePresenterSceneImage } from "./spokesmodel.ts";

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const vars = { SUPABASE_URL: "https://audit.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", GEMINI_API_KEY: "test-api-key" };
  const old = Object.fromEntries(Object.keys(vars).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(vars)) Deno.env.set(key, value);
  return fn().finally(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });
}

Deno.test("ensureSpokesmodelReference gera e persiste a referência quando ausente, reservando orçamento próprio", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    let reservedKind = "";
    let persistedUrl: string | null = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.hostname === "generativelanguage.googleapis.com") {
        return json({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("ref-image-bytes"), mimeType: "image/png" } }] } }] });
      }
      if (url.pathname.endsWith("/rpc/reserve_gemini_call")) { reservedKind = body?.p_kind ?? ""; return json(true); }
      if (url.pathname.endsWith("/system_config")) {
        if (method === "PATCH") { persistedUrl = body?.value?.reference_image_url ?? null; return new Response(null, { status: 204 }); }
        return json({ value: { gemini_spokesmodel_cost_usd_estimate: 0.04 } });
      }
      if (url.pathname.startsWith("/storage/")) return json({ Key: "branding/spokesmodel/reference.png" });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      const db = createServiceClient();
      const logger = new JobLogger(db, "test");
      const result = await ensureSpokesmodelReference({
        db,
        logger,
        episodeId: "11111111-1111-4111-8111-111111111111",
        bucket: "assets",
        cfg: { enabled: true, character_description: "Mulher, 30 anos, cabelo cacheado", reference_image_url: null, max_scenes_per_episode: 1 },
        imageModel: "gemini-2.5-flash-image",
      });
      assertNotEquals(result, null);
      assertEquals(new TextDecoder().decode(result!.bytes), "ref-image-bytes");
      assertEquals(reservedKind, "spokesmodel");
      assertMatch(persistedUrl ?? "", /reference\.png$/);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));

Deno.test("ensureSpokesmodelReference retorna null quando desabilitado (opt-in real)", () =>
  withEnv(async () => {
    const db = createServiceClient();
    const logger = new JobLogger(db, "test");
    const result = await ensureSpokesmodelReference({
      db,
      logger,
      episodeId: "11111111-1111-4111-8111-111111111111",
      bucket: "assets",
      cfg: { enabled: false, character_description: "Mulher, 30 anos", reference_image_url: null, max_scenes_per_episode: 1 },
      imageModel: "gemini-2.5-flash-image",
    });
    assertEquals(result, null);
  }));

Deno.test("generatePresenterSceneImage envia a imagem de referência antes do texto no prompt", () =>
  withEnv(async () => {
    const savedFetch = globalThis.fetch;
    let sentParts: Array<Record<string, unknown>> = [];
    let reservedKind = "";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.hostname === "generativelanguage.googleapis.com") {
        sentParts = body?.contents?.[0]?.parts ?? [];
        return json({ candidates: [{ content: { parts: [{ inlineData: { data: btoa("scene-image-bytes"), mimeType: "image/png" } }] } }] });
      }
      if (url.pathname.endsWith("/rpc/reserve_gemini_call")) { reservedKind = body?.p_kind ?? ""; return json(true); }
      if (url.pathname.endsWith("/system_config")) return json({ value: { gemini_spokesmodel_cost_usd_estimate: 0.04 } });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      const db = createServiceClient();
      const logger = new JobLogger(db, "test");
      const img = await generatePresenterSceneImage({
        db,
        logger,
        episodeId: "11111111-1111-4111-8111-111111111111",
        imageModel: "gemini-2.5-flash-image",
        sceneDescription: "Segurando o produto sorrindo, cozinha ao fundo",
        characterDescription: "Mulher, 30 anos, cabelo cacheado",
        reference: { bytes: new TextEncoder().encode("ref-image-bytes"), mimeType: "image/png" },
      });
      assertEquals(new TextDecoder().decode(img.bytes), "scene-image-bytes");
      assertEquals(reservedKind, "spokesmodel");
      assertEquals(sentParts.length, 2);
      assertEquals((sentParts[0] as { inlineData?: { data?: string } }).inlineData?.data, btoa("ref-image-bytes"));
      assertMatch(String((sentParts[1] as { text?: string }).text), /mesmo personagem/);
    } finally {
      globalThis.fetch = savedFetch;
    }
  }));
