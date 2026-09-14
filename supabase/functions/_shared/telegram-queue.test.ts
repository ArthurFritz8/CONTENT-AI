import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { parseQueueCommand, queueReply } from "./telegram-queue.ts";
import { handleTelegram } from "../telegram-bot/handler.ts";

const ideaId = "66666666-6666-4666-8666-666666666666";
const briefing = "Mostrar como um carregador compacto organiza a mesa de trabalho.";
Deno.test("queue parser keeps briefing and explicit affiliate metadata separate", () => {
  assertEquals(parseQueueCommand(`/ideia ${briefing}\nAfiliado: https://example.com/product?ref=test`),
    { command: "idea", briefing, productUrl: "https://example.com/product?ref=test" });
  assertEquals(parseQueueCommand(`/IDEIA ${briefing}`), { command: "idea", briefing, productUrl: null });
  assertEquals(parseQueueCommand("/fila"), { command: "queue" });
  assertEquals(parseQueueCommand(`/cancelar ${ideaId}`), { command: "cancel", ideaId });
  assertEquals(parseQueueCommand("/revisar"), null);
  for (const command of ["/ideia curto", `/ideia ${"x".repeat(2001)}`, "/fila extra", "/cancelar inválido",
    `/ideia ${briefing}\nAfiliado: http://example.com`, `/ideia ${briefing}\nAfiliado: https://user:password@example.com`,
    `/ideia ${briefing}\nAfiliado: https://a.test\nAfiliado: https://b.test`]) assertThrows(() => parseQueueCommand(command));
});
Deno.test("queue reply fits Telegram even for emoji briefings and distinguishes idea from episode", () => {
  const message = queueReply({ code: "queue", total_pending: 20, pipeline_enabled: false,
    items: Array.from({ length: 10 }, () => ({ id: ideaId, briefing: "🔋".repeat(100) })),
    recent: Array.from({ length: 3 }, () => ({ episode_id: ideaId, status: "review" })) });
  assertEquals(message.length < 4096, true);
  assertStringIncludes(message, "geração está pausada");
  assertStringIncludes(message, "aguardando revisão");
  assertStringIncludes(queueReply({ code: "created", idea_id: ideaId, commercial: true, pipeline_enabled: true }), "divulgação comercial será obrigatória");
});

async function fixture(mode: "success" | "network" | "database", run: (calls: { rpc: number; messages: number; states: string[] }) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_CHAT_ID: "-123", TELEGRAM_USER_ID: "456", TELEGRAM_WEBHOOK_SECRET: "fixture-webhook-secret-with-32-characters" };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const seen = new Set<number>();
  const calls = { rpc: 0, messages: 0, states: [] as string[] };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.hostname === "api.telegram.org") {
      calls.messages++;
      assertEquals(body.parse_mode, undefined);
      if (mode === "network") throw new Error(`secret in URL ${url.href}`);
      return json({ ok: true, result: { message_id: 99 } });
    }
    if (url.pathname.endsWith("/rpc/telegram_queue_command")) {
      calls.rpc++;
      assertEquals(body.p_chat_id, "-123"); assertEquals(body.p_user_id, "456");
      if (mode === "database") return json({ message: "Database unavailable" }, 500);
      if (seen.has(body.p_update_id)) return json({ duplicate: true });
      seen.add(body.p_update_id);
      return json({ code: "created", idea_id: ideaId, pipeline_enabled: false, commercial: false });
    }
    if (url.pathname.endsWith("/telegram_commands")) {
      if (init?.method === "PATCH") { calls.states.push(body.reply_status); return new Response(null, { status: 204 }); }
      if (seen.has(body.update_id)) return json([]);
      seen.add(body.update_id); return json([{ update_id: body.update_id }]);
    }
    throw new Error("Unexpected call");
  }) as typeof fetch;
  try { await run(calls); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
}
function request(text = `/ideia ${briefing}`, userId = 456) {
  return new Request("https://worker.test", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "fixture-webhook-secret-with-32-characters" },
    body: JSON.stringify({ update_id: 100, message: { message_id: 1, chat: { id: -123 }, from: { id: userId, is_bot: false }, text } }) });
}
Deno.test("queue command is durable before confirmation and duplicate delivery sends no second message", async () => {
  await fixture("success", async calls => {
    assertEquals((await handleTelegram(request(undefined, 777))).status, 403);
    assertEquals(calls.rpc, 0);
    assertEquals((await (await handleTelegram(request())).json()).reply_status, "sent");
    assertEquals((await (await handleTelegram(request())).json()).duplicate, true);
    assertEquals(calls.messages, 1); assertEquals(calls.states, ["sent"]);
  });
});
Deno.test("Telegram timeout preserves command and database failure never confirms creation", async () => {
  await fixture("network", async calls => {
    const response = await handleTelegram(request());
    assertEquals(response.status, 200);
    const body = await response.json(); assertEquals(body.reply_status, "uncertain");
    assertEquals(JSON.stringify(body).includes("fixture-token"), false);
    await handleTelegram(request()); assertEquals(calls.messages, 1);
  });
  await fixture("database", async calls => {
    assertEquals((await handleTelegram(request())).status, 500);
    assertEquals(calls.messages, 0);
  });
});
Deno.test("invalid queue command sends guidance once without retrying the webhook or creating an idea", async () => {
  await fixture("success", async calls => {
    assertEquals((await handleTelegram(request("/ideia curto"))).status, 200);
    await handleTelegram(request("/ideia curto"));
    assertEquals(calls.rpc, 0); assertEquals(calls.messages, 1);
  });
});
