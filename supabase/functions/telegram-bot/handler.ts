import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { requireTelegramSecret, telegramCall, telegramConfig } from "../_shared/telegram.ts";
import { sendReview } from "../_shared/review-delivery.ts";

const id = z.number().int().safe();
const sender = z.object({ id, is_bot: z.literal(false) });
const message = z.object({ message_id: id.positive(), chat: z.object({ id }),
  from: z.object({ id, is_bot: z.boolean() }).optional(), text: z.string().max(4096).optional() });
const updateSchema = z.object({ update_id: id.nonnegative(),
  callback_query: z.object({ id: z.string().min(1).max(256), from: sender, message,
    data: z.string().max(64) }).optional(), message: message.optional(),
});

async function readUpdate(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("Update vazio", 400, "INVALID_UPDATE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new AppError("Update muito grande", 413, "INVALID_UPDATE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return updateSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); }
  catch { throw new AppError("Update inválido", 400, "INVALID_UPDATE"); }
}

const resultText: Record<string, string> = {
  approved: "Versão aprovada. Nenhum vídeo foi publicado por esta ação.",
  rerender_requested: "Novo render solicitado. Roteiro e assets foram preservados.",
  rejected: "Episódio reprovado e interrompido para correção.",
  stale: "Esta revisão ficou desatualizada. Solicite uma nova com /revisar e o ID do episódio.",
  already_decided: "Esta revisão já recebeu uma decisão.",
  unauthorized: "Esta mensagem não pode autorizar a revisão.", not_found: "Revisão não encontrada.",
};

export async function handleTelegram(req: Request): Promise<Response> {
  try {
    const config = telegramConfig();
    requireTelegramSecret(req, config.webhookSecret);
    if (req.method !== "POST") throw new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED");
    const update = await readUpdate(req);
    const callback = update.callback_query;
    const msg = callback?.message ?? update.message;
    const user = callback?.from ?? update.message?.from;
    if (!msg || !user) return jsonResponse({ ignored: true });
    if (user.is_bot || String(msg.chat.id) !== config.chatId || String(user.id) !== config.userId) {
      throw new AppError("Chat ou usuário não permitido", 403, "FORBIDDEN");
    }
    const db = createServiceClient();
    if (callback) {
      const match = /^rv:([arx]):([0-9a-f-]{36})$/.exec(callback.data);
      const requestId = z.string().uuid().safeParse(match?.[2]);
      if (!match || !requestId.success) throw new AppError("Botão inválido", 400, "INVALID_CALLBACK");
      const actions: Record<string, string> = { a: "approve", r: "rerender", x: "reject" };
      const { data, error } = await db.rpc("decide_review", { p_request_id: requestId.data, p_update_id: update.update_id,
        p_action: actions[match[1]!], p_chat_id: config.chatId, p_user_id: config.userId, p_message_id: msg.message_id });
      if (error) throw new AppError("Não foi possível registrar decisão", 500, "DB_ERROR");
      // Decision is already durable; a failed UI acknowledgement must not repeat it.
      try { await telegramCall("answerCallbackQuery", { callback_query_id: callback.id,
        text: resultText[String(data)] ?? "Decisão não confirmada.", show_alert: true }); } catch { /* Telegram will expire the spinner */ }
      return jsonResponse({ result: data });
    }
    const text = msg.text?.trim() ?? "";
    const review = /^\/revisar\s+([0-9a-f-]{36})$/i.exec(text);
    const episode = z.string().uuid().safeParse(review?.[1]);
    const { data: reserved, error } = await db.from("telegram_commands").upsert({ update_id: update.update_id,
      chat_id: config.chatId, user_id: config.userId, command: episode.success ? "review" : "help" },
      { onConflict: "update_id", ignoreDuplicates: true }).select("update_id");
    if (error) throw new AppError("Erro ao registrar comando", 500, "DB_ERROR");
    if (!reserved?.length) return jsonResponse({ duplicate: true });
    if (episode.success) {
      const sent = await sendReview(db, episode.data, true);
      if (sent?.review_sent) return jsonResponse(sent);
    }
    await telegramCall("sendMessage", { chat_id: config.chatId,
      text: "CONTENT AI — Revisão editorial\n\nVocê recebe título, resumo, vídeos e um anexo com roteiro, fontes e licenças.\n\nAprovar registra a versão; não publica. Refazer render mantém roteiro/assets. Reprovar interrompe o episódio.\n\n/revisar UUID_DO_EPISÓDIO — solicita uma nova ficha de episódio em review, invalidando botões anteriores.\n\nSe nenhuma ficha chegou, confirme o estado review e telegram.enabled. Em entrega incerta, envie o comando novamente como uma nova mensagem." });
    return jsonResponse({ ok: true });
  } catch (err) { return toErrorResponse(err); }
}
