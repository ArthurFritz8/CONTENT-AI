import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handleTelegram } from "../telegram-bot/handler.ts";
import { sendReview } from "./review-delivery.ts";
import { createServiceClient } from "./supabase-client.ts";
import { makeReviewSnapshot } from "../../../packages/core/src/testing/review-fixture.ts";

const requestId = "33333333-3333-4333-8333-333333333333";
const secret = "fixture-webhook-secret-with-32-characters";
const callback = (updateId = 1) => ({ update_id: updateId, callback_query: { id: "callback-fixture", data: `rv:a:${requestId}`,
  from: { id: 456, is_bot: false }, message: { message_id: 10, chat: { id: -123 }, from: { id: 999, is_bot: true } } } });
function req(body: unknown, header = secret) {
  return new Request("https://worker.test", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": header }, body: JSON.stringify(body) });
}

async function fixture(options: { timeout?: boolean; failSave?: boolean; invalidPacket?: boolean; enabled?: boolean; result?: string },
  run: (state: { calls: Array<{ method: string; body: unknown }>; dbCalls: Array<{ path: string; body: unknown }>;
    review: Record<string, unknown> }) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const env = { TELEGRAM_BOT_TOKEN: "fixture-token", TELEGRAM_CHAT_ID: "-123", TELEGRAM_USER_ID: "456", TELEGRAM_WEBHOOK_SECRET: secret,
    SUPABASE_URL: "https://telegram.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key" };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const snapshot = makeReviewSnapshot();
  if (options.invalidPacket) snapshot.episode.script_json.metadata.youtube.title = "Cura tudo";
  const review: Record<string, unknown> = { id: requestId, episode_id: snapshot.episode.id, snapshot, delivery_status: "sending" };
  const calls: Array<{ method: string; body: unknown }> = [];
  const dbCalls: Array<{ path: string; body: unknown }> = [];
  let prepared = false;
  const commands = new Set<number>();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    if (url.hostname === "api.telegram.org") {
      calls.push({ method: url.pathname.split("/").at(-1)!, body });
      if (options.timeout) throw new Error(`Network error: ${url.href}`);
      return json({ ok: true, result: { message_id: 10, chat: { id: -123 } } });
    }
    dbCalls.push({ path: url.pathname, body });
    if (url.pathname.endsWith("/system_config")) return json({ value: { enabled: options.enabled !== false } });
    if (url.pathname.endsWith("/rpc/prepare_review")) {
      if (prepared && !body.p_force) return json(null);
      prepared = true; return json(review);
    }
    if (url.pathname.endsWith("/rpc/decide_review")) return json(options.result ?? "approved");
    if (url.pathname.endsWith("/review_requests")) {
      if (options.failSave && body.delivery_status === "sent") return json({ message: "save unavailable" }, 500);
      Object.assign(review, body);
      return url.searchParams.has("select") ? json({ id: requestId }) : new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/telegram_commands")) {
      if (commands.has(body.update_id)) return json([]);
      commands.add(body.update_id); return json([{ update_id: body.update_id }]);
    }
    throw new Error(`Unexpected database call: ${url.pathname}`);
  }) as typeof fetch;
  try { await run({ calls, dbCalls, review }); }
  finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

Deno.test("Telegram autentica secret/chat/usuário antes de acessar banco ou responder", async () => {
  await fixture({}, async ({ calls, dbCalls }) => {
    assertEquals((await handleTelegram(req(callback(), "invalid"))).status, 401);
    const wrongUser = callback(); wrongUser.callback_query.from.id = 777;
    assertEquals((await handleTelegram(req(wrongUser))).status, 403);
    const wrongChat = callback(); wrongChat.callback_query.message.chat.id = -999;
    assertEquals((await handleTelegram(req(wrongChat))).status, 403);
    assertEquals(calls.length, 0); assertEquals(dbCalls.length, 0);
  });
});

Deno.test("callback de mensagem do próprio bot registra decisão com identidade e mensagem corretas", async () => {
  await fixture({}, async ({ calls, dbCalls }) => {
    assertEquals((await handleTelegram(req(callback()))).status, 200);
    assertEquals(dbCalls[0]!.body, { p_request_id: requestId, p_update_id: 1, p_action: "approve", p_chat_id: "-123", p_user_id: "456", p_message_id: 10 });
    assertEquals(calls[0]!.method, "answerCallbackQuery");
    assertStringIncludes(JSON.stringify(calls[0]!.body), "Nenhum vídeo foi publicado");
  });
});

Deno.test("callback obsoleto é informado sem iniciar render ou publicação", async () => {
  await fixture({ result: "stale" }, async ({ calls, dbCalls }) => {
    const response = await handleTelegram(req(callback()));
    assertEquals((await response.json()).result, "stale");
    assertEquals(dbCalls.length, 1);
    assertStringIncludes(JSON.stringify(calls[0]!.body), "desatualizada");
  });
});

Deno.test("payload inválido, botão inválido e body excessivo não executam ações", async () => {
  await fixture({}, async ({ calls, dbCalls }) => {
    assertEquals((await handleTelegram(req({ update_id: -1 }))).status, 400);
    const bad = callback(); bad.callback_query.data = "publish:now";
    assertEquals((await handleTelegram(req(bad))).status, 400);
    assertEquals((await handleTelegram(req({ update_id: 1, large: "a".repeat(66000) }))).status, 413);
    assertEquals(calls.length, 0); assertEquals(dbCalls.length, 0);
  });
});

Deno.test("uma única chamada entrega documento, vídeos e botões; próximo tick não duplica", async () => {
  await fixture({}, async ({ calls, review }) => {
    assertEquals((await sendReview(createServiceClient()))?.review_sent, true);
    assertEquals(await sendReview(createServiceClient()), null);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]!.method, "sendDocument");
    const body = calls[0]!.body as FormData;
    assertEquals(body.get("parse_mode"), null);
    assertStringIncludes(String(body.get("reply_markup")), "Aprovar versão");
    assertStringIncludes(await (body.get("document") as Blob).text(), "ROTEIRO COMPLETO");
    assertEquals(review.delivery_status, "sent"); assertEquals(review.message_id, 10);
  });
});

Deno.test("timeout ou falha ao salvar confirmação deixa entrega incerta sem expor token nem repetir POST", async () => {
  for (const options of [{ timeout: true }, { failSave: true }]) {
    await fixture(options, async ({ calls, review }) => {
      const result = await sendReview(createServiceClient());
      assertEquals(result?.delivery_status, "uncertain");
      assertEquals(JSON.stringify(result).includes("fixture-token"), false);
      assertEquals(review.delivery_status, "uncertain");
      assertEquals(await sendReview(createServiceClient()), null);
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("config desativada ou QA reprovado não envia mensagem", async () => {
  for (const options of [{ enabled: false }, { invalidPacket: true }]) {
    await fixture(options, async ({ calls }) => {
      await sendReview(createServiceClient()); assertEquals(calls.length, 0);
    });
  }
});

Deno.test("comando duplicado não reenvia nem invalida outra ficha", async () => {
  await fixture({}, async ({ calls, dbCalls }) => {
    const command = { update_id: 77, message: { message_id: 5, chat: { id: -123 }, from: { id: 456, is_bot: false }, text: `/revisar ${makeReviewSnapshot().episode.id}` } };
    assertEquals((await handleTelegram(req(command))).status, 200);
    assertEquals((await (await handleTelegram(req(command))).json()).duplicate, true);
    assertEquals(calls.length, 1);
    assertEquals(dbCalls.filter(call => call.path.endsWith("/rpc/prepare_review")).length, 1);
  });
});
