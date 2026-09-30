import { z } from "zod";
import { requireServiceRole } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import {
  AppError,
  jsonResponse,
  toErrorResponse,
} from "../_shared/error-handler.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { codeHash, tokenTelegram } from "../_shared/studio-telegram.ts";
const schema = z.object({
  workspace: z.string().uuid(),
  actor: z.string().uuid(),
  mode: z.enum(["shared", "own"]),
  token: z
    .string()
    .regex(/^[0-9]{5,16}:[A-Za-z0-9_-]{25,80}$/)
    .optional(),
});
Deno.serve(async (req) => {
  try {
    requireServiceRole(req);
    const i = await parseJsonBody(req, schema),
      db = createServiceClient();
    const { error } = await db.rpc("studio_assert_member", {
      p_workspace: i.workspace,
      p_actor: i.actor,
    });
    if (error) throw new AppError("Sem acesso", 403, "FORBIDDEN");
    const { data: q } = await db.rpc("studio_reserve_usage", {
      p_workspace: i.workspace,
      p_kind: "help",
      p_limit: 10,
    });
    if (!q)
      throw new AppError("Limite de tentativas atingido", 429, "DAILY_LIMIT");
    const shared = Deno.env.get("TELEGRAM_BOT_TOKEN"),
      token = i.mode === "own" ? i.token : shared;
    if (!token)
      throw new AppError("Bot ainda não configurado", 503, "CONFIG_MISSING");
    const me = await tokenTelegram(token, "getMe");
    if (!me?.is_bot || !/^[A-Za-z0-9_]{5,32}$/.test(me.username))
      throw new AppError("Bot inválido", 400, "INVALID_BOT");
    if (i.mode === "own") {
      if (token === shared)
        throw new AppError(
          "Use a conexão compartilhada para este bot",
          409,
          "SHARED_BOT",
        );
      const hook = await tokenTelegram(token, "getWebhookInfo"),
        url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/studio-telegram-hook?workspace=${i.workspace}`;
      if (hook?.url && hook.url !== url)
        throw new AppError(
          "Este bot já está conectado a outro serviço. Use um bot dedicado ao Studio.",
          409,
          "WEBHOOK_IN_USE",
        );
      const secret =
        crypto.randomUUID().replaceAll("-", "") +
        crypto.randomUUID().replaceAll("-", "");
      const { error: se } = await db.rpc("studio_store_secret", {
        p_workspace: i.workspace,
        p_provider: "telegram",
        p_value: { token, webhook_secret: secret },
        p_metadata: { mode: "own", username: me.username },
      });
      if (se) throw new AppError("Falha ao guardar conexão", 500, "DB_ERROR");
      await tokenTelegram(token, "setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["message"],
      });
    }
    if (i.mode === "shared") {
      const { error: ce } = await db
        .from("studio_connections")
        .upsert(
          {
            workspace_id: i.workspace,
            provider: "telegram",
            status: "pending",
            secret_id: null,
            metadata: { mode: "shared", username: me.username },
          },
          { onConflict: "workspace_id,provider" },
        );
      if (ce) throw new AppError("Falha ao preparar conexão", 500, "DB_ERROR");
    }
    const code = crypto.randomUUID().replaceAll("-", "");
    const { error: ce } = await db
      .from("studio_telegram_links")
      .insert({
        code_hash: await codeHash(code),
        workspace_id: i.workspace,
        actor: i.actor,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
    if (ce) throw new AppError("Falha ao criar vínculo", 500, "DB_ERROR");
    return jsonResponse({
      url: `https://t.me/${me.username}?start=studio_${code}`,
      expires_minutes: 10,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
});
