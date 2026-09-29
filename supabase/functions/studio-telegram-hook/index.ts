import { z } from "zod";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { requireTelegramSecret } from "../_shared/telegram.ts";
import {
  acceptStudioStart,
  tokenTelegram,
} from "../_shared/studio-telegram.ts";
import {
  jsonResponse,
  toErrorResponse,
  AppError,
} from "../_shared/error-handler.ts";
import { parseJsonBody } from "../_shared/validators.ts";
Deno.serve(async (req) => {
  try {
    const workspace = z
        .string()
        .uuid()
        .parse(new URL(req.url).searchParams.get("workspace")),
      db = createServiceClient();
    const { data: secret } = await db.rpc("studio_read_secret", {
      p_workspace: workspace,
      p_provider: "telegram",
    });
    if (!secret?.webhook_secret)
      throw new AppError("Sem acesso", 403, "FORBIDDEN");
    requireTelegramSecret(req, secret.webhook_secret);
    const data = await parseJsonBody(
      req,
      z.object({
        message: z
          .object({
            text: z.string().max(4096).optional(),
            chat: z.object({ id: z.number().int().safe() }),
            from: z.object({
              id: z.number().int().safe(),
              is_bot: z.boolean(),
            }),
          })
          .optional(),
      }),
    );
    const m = data.message;
    if (!m || m.from.is_bot) return jsonResponse({ ignored: true });
    const linked = await acceptStudioStart(
      db,
      m.text || "",
      String(m.chat.id),
      String(m.from.id),
      workspace,
    );
    if (linked)
      await tokenTelegram(secret.token, "sendMessage", {
        chat_id: m.chat.id,
        text: "Telegram conectado ao seu Studio. Os próximos vídeos chegarão com um link para revisão no painel.",
      });
    return jsonResponse({ linked });
  } catch (e) {
    return toErrorResponse(e);
  }
});
