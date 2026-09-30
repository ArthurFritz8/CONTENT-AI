import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
export async function tokenTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw Error();
    return d.result;
  } catch {
    throw new AppError(
      "Telegram não confirmou a operação",
      502,
      "TELEGRAM_UNCERTAIN",
    );
  }
}
export async function codeHash(code: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function acceptStudioStart(
  db: SupabaseClient,
  text: string,
  chat: string,
  user: string,
  workspace?: string,
) {
  const match = /^\/start\s+studio_([a-f0-9]{32})$/.exec(text);
  if (!match || chat !== user) return false;
  const { data, error } = await db.rpc("studio_link_telegram", {
    p_hash: await codeHash(match[1]),
    p_chat: chat,
    p_user: user,
    p_workspace: workspace || null,
  });
  if (error) throw new AppError("Falha ao vincular Telegram", 500, "DB_ERROR");
  return data === true;
}
export async function sendStudioNotifications(db: SupabaseClient) {
  const app = Deno.env.get("STUDIO_APP_URL");
  if (!app?.startsWith("https://")) return null;
  const { data: episodes } = await db
    .from("episodes")
    .select("id,workspace_id")
    .eq("status", "review")
    .neq("workspace_id", "00000000-0000-4000-8000-000000000001")
    .order("created_at")
    .limit(10);
  for (const ep of episodes || []) {
    const { data: con } = await db
      .from("studio_connections")
      .select("metadata,status")
      .eq("workspace_id", ep.workspace_id)
      .eq("provider", "telegram")
      .eq("status", "connected")
      .maybeSingle();
    if (!con?.metadata?.chat_id) continue;
    const { data: review, error } = await db.rpc("studio_ensure_review", {
      p_episode: ep.id,
    });
    if (error || !review?.id) continue;
    const { data: reserved, error: re } = await db
      .from("studio_notifications")
      .upsert(
        { review_id: review.id, workspace_id: ep.workspace_id },
        { onConflict: "review_id", ignoreDuplicates: true },
      )
      .select("review_id");
    if (re || !reserved?.length) continue;
    let token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (con.metadata.mode === "own") {
      const { data: secret } = await db.rpc("studio_read_secret", {
        p_workspace: ep.workspace_id,
        p_provider: "telegram",
      });
      token = secret?.token;
    }
    try {
      if (!token) throw Error();
      await tokenTelegram(token, "sendMessage", {
        chat_id: con.metadata.chat_id,
        text: "Seu vídeo está pronto para revisão no Studio. Confira conteúdo, fontes e canais antes de aprovar.",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Revisar no Studio",
                url: `${app}/studio/episodes/${ep.id}`,
              },
            ],
          ],
        },
      });
      await db
        .from("studio_notifications")
        .update({ status: "sent" })
        .eq("review_id", review.id);
    } catch {
      await db
        .from("studio_notifications")
        .update({ status: "uncertain" })
        .eq("review_id", review.id);
    }
    return { studio_notification: true, episode_id: ep.id };
  }
  return null;
}
