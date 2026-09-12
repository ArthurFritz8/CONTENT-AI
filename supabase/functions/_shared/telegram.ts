import { z } from "zod";
import { AppError } from "./error-handler.ts";

const configSchema = z.object({
  token: z.string().min(1), chatId: z.string().regex(/^-?\d+$/), userId: z.string().regex(/^[1-9]\d*$/),
  webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
});
export function telegramConfig() {
  const parsed = configSchema.safeParse({ token: Deno.env.get("TELEGRAM_BOT_TOKEN"), chatId: Deno.env.get("TELEGRAM_CHAT_ID"),
    userId: Deno.env.get("TELEGRAM_USER_ID"), webhookSecret: Deno.env.get("TELEGRAM_WEBHOOK_SECRET") });
  if (!parsed.success) throw new AppError("Configuração Telegram ausente ou inválida", 500, "TELEGRAM_CONFIG_INVALID");
  return parsed.data;
}

export function requireTelegramSecret(req: Request, expected: string): void {
  const actual = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ (actual.charCodeAt(i) || 0);
  if (difference) throw new AppError("Webhook não autorizado", 401, "UNAUTHORIZED");
}

/** Never retry a message POST: a timeout can mean Telegram already accepted it. */
export async function telegramCall(method: "sendDocument" | "sendMessage" | "answerCallbackQuery", body: FormData | Record<string, unknown>): Promise<unknown> {
  const { token } = telegramConfig();
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", signal: AbortSignal.timeout(25_000),
      ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
  } catch {
    // Fetch errors may contain the secret-bearing URL. Do not log/rethrow them.
    throw new AppError("Resultado Telegram desconhecido; não repetir envio automaticamente", 502, "TELEGRAM_UNCERTAIN");
  }
  let json: unknown;
  try { json = await response.json(); } catch {
    throw new AppError("Resposta Telegram não confirmada", 502, "TELEGRAM_UNCERTAIN");
  }
  const parsed = z.object({ ok: z.boolean(), result: z.unknown().optional() }).safeParse(json);
  if (!parsed.success || response.status >= 500) throw new AppError("Resposta Telegram não confirmada", 502, "TELEGRAM_UNCERTAIN");
  if (!response.ok || !parsed.data.ok) throw new AppError("Telegram recusou a solicitação", 502, "TELEGRAM_REJECTED");
  return parsed.data.result;
}
