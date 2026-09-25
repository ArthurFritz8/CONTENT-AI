import { z } from "zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildReviewPacket } from "../../../packages/core/src/review/review-packet.ts";
import { getSystemConfig } from "./supabase-client.ts";
import { AppError } from "./error-handler.ts";
import { telegramCall, telegramConfig } from "./telegram.ts";

export async function sendReview(db: SupabaseClient, episodeId?: string, force = false): Promise<Record<string, unknown> | null> {
  const cfg = await getSystemConfig<{ enabled?: boolean }>(db, "telegram", {});
  if (cfg.enabled !== true) return null;
  const config = telegramConfig();
  const { data, error } = await db.rpc("prepare_review", { p_chat_id: config.chatId, p_user_id: config.userId,
    p_episode_id: episodeId ?? null, p_force: force });
  if (error) throw new AppError("Não foi possível reservar revisão", 500, "DB_ERROR");
  const request = Array.isArray(data) ? data[0] : data;
  if (!request?.id) return null;
  const youtube = await getSystemConfig<{ enabled?: boolean; public_shorts_enabled?: boolean; api_audit_approved?: boolean;
    automatic_after?: string | null }>(db, "youtube", {});
  const activation = youtube.automatic_after ? Date.parse(youtube.automatic_after) : NaN;
  const autoPublishYoutube = youtube.enabled === true && youtube.public_shorts_enabled === true
    && youtube.api_audit_approved === true && Number.isFinite(activation) && activation <= Date.now();
  let postStarted = false;
  try {
    const consent = await db.from("review_requests").update({ youtube_public_consent: autoPublishYoutube })
      .eq("id", request.id).eq("delivery_status", "sending");
    if (consent.error) throw new AppError("Não foi possível registrar consentimento de publicação", 500, "DB_ERROR");
    const packet = buildReviewPacket(request.snapshot, request.id, autoPublishYoutube);
    const body = new FormData();
    body.set("chat_id", config.chatId);
    body.set("caption", packet.caption);
    body.set("reply_markup", JSON.stringify(packet.reply_markup));
    body.set("document", new Blob([packet.document], { type: "text/plain;charset=utf-8" }), packet.filename);
    postStarted = true;
    const sent = z.object({ message_id: z.number().int().positive().safe(), chat: z.object({ id: z.number().int().safe() }) })
      .safeParse(await telegramCall("sendDocument", body));
    if (!sent.success || String(sent.data.chat.id) !== config.chatId) throw new AppError("Entrega Telegram não confirmada", 502, "TELEGRAM_UNCERTAIN");
    const { data: saved, error: saveError } = await db.from("review_requests").update({ delivery_status: "sent", message_id: sent.data.message_id })
      .eq("id", request.id).eq("delivery_status", "sending").select("id").maybeSingle();
    if (saveError || !saved) throw new AppError("Entrega ocorreu, mas confirmação não foi salva", 500, "DB_ERROR");
    return { review_sent: true, episode_id: request.episode_id, review_id: request.id };
  } catch (err) {
    const code = err instanceof AppError ? err.code : "REVIEW_PACKET_INVALID";
    const status = !postStarted || code === "TELEGRAM_REJECTED" ? "failed" : "uncertain";
    const { error: saveError } = await db.from("review_requests").update({ delivery_status: status, delivery_error: code })
      .eq("id", request.id).eq("delivery_status", "sending");
    if (saveError) throw new AppError("Não foi possível registrar falha de entrega", 500, "DB_ERROR");
    return { review_sent: false, episode_id: request.episode_id, review_id: request.id, delivery_status: status, code };
  }
}
