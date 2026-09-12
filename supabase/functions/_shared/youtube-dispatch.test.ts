import { assertEquals } from "jsr:@std/assert@1";
import { handlePublishYoutube } from "../publish-youtube/handler.ts";

Deno.test("publisher authenticates, validates, reserves dispatch before HTTP and suppresses repetition", async () => {
  const previous = globalThis.fetch;
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", GITHUB_TOKEN: "fixture-github", GITHUB_REPO: "fixture/repo" };
  const savedEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  let enabled = false;
  let dispatches = 0;
  let calls = 0;
  let metadata: Record<string, unknown> = {};
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input, init) => {
    calls++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.github.com") {
      assertEquals(typeof metadata.youtube_dispatch_at, "string");
      assertEquals(url.pathname.endsWith("/publish-youtube.yml/dispatches"), true);
      dispatches++; return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/system_config")) return json({ value: { enabled } });
    if (url.pathname.endsWith("/rpc/claim_episode")) return json(true);
    if (url.pathname.endsWith("/episode_leases")) return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/episodes")) {
      if (init?.method === "PATCH") { metadata = JSON.parse(String(init.body)).metadata; return new Response(null, { status: 204 }); }
      return json({ status: "review", approval_fingerprint: "fixture-fingerprint", metadata });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch;
  const request = (body: unknown, auth = "fixture-service") => new Request("https://worker.test", { method: "POST",
    headers: { Authorization: `Bearer ${auth}` }, body: JSON.stringify(body) });
  const input = { episode_id: "11111111-1111-4111-8111-111111111111" };
  try {
    assertEquals((await handlePublishYoutube(request(input, "anonymous"))).status, 401);
    assertEquals((await handlePublishYoutube(request({ ...input, privacy: "public" }))).status, 400);
    assertEquals(calls, 0);
    assertEquals(await (await handlePublishYoutube(request(input))).json(), { paused: true });
    assertEquals(dispatches, 0);
    enabled = true;
    assertEquals((await handlePublishYoutube(request(input))).status, 202);
    assertEquals(await (await handlePublishYoutube(request(input))).json(), { dispatched: false, reason: "dispatch_recent" });
    assertEquals(dispatches, 1);
  } finally {
    globalThis.fetch = previous;
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
});
