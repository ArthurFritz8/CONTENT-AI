import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { TikTokShopClient, signTikTokRequest } from "./tiktok-shop.ts";

Deno.test("assinatura exclui sign/access_token e ordena parâmetros", async () => {
  const a = await signTikTokRequest("secret", "/affiliate_creator/202405/test", { timestamp: "1", app_key: "a", sign: "old", access_token: "hidden", z: "2" }, "{}");
  const b = await signTikTokRequest("secret", "/affiliate_creator/202405/test", { z: "2", app_key: "a", timestamp: "1" }, "{}");
  assertEquals(a, b);
  assertEquals(a.length, 64);
});

Deno.test("cliente envia busca com body, token e assinatura sem vazar credenciais em erro", async () => {
  let called: Request | undefined;
  const client = new TikTokShopClient({ appKey: "app", appSecret: "secret", creatorAccessToken: "token" }, async (input, init) => {
    called = new Request(input, init);
    return new Response(JSON.stringify({ code: 0, request_id: "req-1", data: { products: [] } }), { status: 200 });
  }, () => 1_700_000_000);
  const result = await client.searchOpenCollaborationProducts({ keywords: ["luminária", "mesa"], pageSize: 2, sortField: "commission_rate", sortOrder: "DESC" });
  assertEquals(result.requestId, "req-1");
  assertEquals(JSON.parse(await called!.text()), { title_keywords: ["luminária", "mesa"] });
  assertEquals(called!.headers.get("x-tts-access-token"), "token");
  assertEquals(new URL(called!.url).searchParams.get("page_size"), "2");
  assertEquals(new URL(called!.url).searchParams.get("sign")?.length, 64);
});

Deno.test("cliente rejeita página fora do contrato e respostas API sem expor o token", async () => {
  const client = new TikTokShopClient({ appKey: "app", appSecret: "secret", creatorAccessToken: "do-not-log" }, async () => new Response(JSON.stringify({ code: 16015001, message: "bad token" }), { status: 200 }));
  await assertRejects(() => client.searchOpenCollaborationProducts({ pageSize: 21 }), Error, "page_size");
  await assertRejects(() => client.searchOpenCollaborationProducts(), Error, "TikTok Shop recusou");
});
