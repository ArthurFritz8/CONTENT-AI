import { z } from "zod";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";
import { telegramCall } from "./telegram.ts";

type QueueCommand = { command: "idea"; briefing: string; productUrl: string | null }
  | { command: "queue" } | { command: "cancel"; ideaId: string };
const affiliateUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});
export function parseQueueCommand(text: string): QueueCommand | null {
  const match = /^\/(ideia|fila|cancelar)(?:\s+([\s\S]*))?$/iu.exec(text.trim());
  if (!match) return null;
  const command = match[1]!.toLowerCase();
  const args = match[2]?.trim() ?? "";
  if (command === "fila") {
    if (args) throw new AppError("Use /fila sem argumentos", 400, "INVALID_COMMAND");
    return { command: "queue" };
  }
  if (command === "cancelar") {
    const id = z.string().uuid().safeParse(args);
    if (!id.success) throw new AppError("Use /cancelar com o ID completo da ideia mostrado em /fila", 400, "INVALID_COMMAND");
    return { command: "cancel", ideaId: id.data };
  }
  const lines = args.split(/\r?\n/u);
  const links = lines.filter(line => /^Afiliado:/iu.test(line.trim()));
  const briefing = lines.filter(line => !/^Afiliado:/iu.test(line.trim())).join("\n").trim();
  const length = Array.from(briefing).length;
  if (length < 20 || length > 2000) throw new AppError("Use /ideia com uma descrição de 20 a 2.000 caracteres: produto, problema e abordagem do vídeo", 400, "INVALID_COMMAND");
  if (links.length > 1) throw new AppError("Informe apenas uma linha Afiliado: URL", 400, "INVALID_COMMAND");
  const link = links[0]?.trim().replace(/^Afiliado:\s*/iu, "").trim();
  if (link !== undefined && !affiliateUrl.safeParse(link).success) throw new AppError("Afiliado: exige uma URL HTTPS sem credenciais", 400, "INVALID_COMMAND");
  return { command: "idea", briefing, productUrl: link ?? null };
}

const resultSchema = z.object({ code: z.string(), idea_id: z.string().uuid().optional(), episode_id: z.string().uuid().optional(),
  commercial: z.boolean().optional(), pipeline_enabled: z.boolean().optional(), limit: z.number().optional(), total_pending: z.number().optional(),
  items: z.array(z.object({ id: z.string().uuid(), briefing: z.string().max(200) })).max(10).optional(),
  recent: z.array(z.object({ episode_id: z.string().uuid(), status: z.string() })).max(3).optional(),
});
export function queueReply(result: unknown): string {
  const row = resultSchema.parse(result);
  const pipeline = row.pipeline_enabled ? "A geração está ativa: o pipeline poderá iniciar esta pauta respeitando o limite diário." : "A geração está pausada. As ideias ficam guardadas até você ativar o pipeline.";
  const labels: Record<string, string> = { idea: "ideia", research: "pesquisa", script: "roteiro", assets: "imagens e áudio",
    rendered: "render concluído", review: "aguardando revisão", published: "publicado", analyze: "análise", failed: "precisa de correção" };
  switch (row.code) {
    case "created": return `IDEIA ADICIONADA\n\nID: ${row.idea_id}\n${row.commercial ? "Link de afiliado registrado. A divulgação comercial será obrigatória." : "Pauta sem link de afiliado registrado."}\n\n${pipeline}\n\n/fila — consultar pautas\n/cancelar ${row.idea_id} — retirar antes de começar\n\nA publicação exige revisão e aprovação do vídeo.`;
    case "queue": return ["SUA FILA DE CONTEÚDO", `\n${row.total_pending ?? 0} ideia(s) aguardando geração.`, pipeline, "",
      ...(row.items ?? []).flatMap((item, index) => [`${index + 1}. ${item.briefing.replace(/\s+/gu, " ")}`, `ID: ${item.id}`, ""]),
      ...(row.recent?.length ? ["EPISÓDIOS RECENTES", ...row.recent.map(item => `${labels[item.status] ?? "em andamento"} — ${item.episode_id}`), ""] : []),
      "Mostrando até 10 ideias na ordem de prioridade e chegada.", "/ideia descrição — adicionar pauta", "/cancelar ID_DA_IDEIA — retirar uma pauta pendente", "/revisar ID_DO_EPISÓDIO — reabrir uma revisão",
    ].join("\n");
    case "cancelled": return `Ideia retirada da fila.\nID: ${row.idea_id}\n\nNenhum episódio foi cancelado. Consulte /fila.`;
    case "already_cancelled": return "Esta ideia já foi retirada da fila. Consulte /fila.";
    case "already_started": return `Esta ideia já começou a ser produzida e não pode ser retirada da fila.\nEpisódio: ${row.episode_id}\n\nA revisão do vídeo continua obrigatória antes de publicar.`;
    case "not_found": return "Ideia não encontrada. Use o ID da ideia mostrado em /fila.";
    case "queue_full": return `A fila atingiu o limite de ${row.limit} ideias pendentes. Consulte /fila e retire uma pauta antes de adicionar outra.`;
    case "daily_limit": return `O limite de ${row.limit} novas ideias por dia foi atingido. Ele reinicia à meia-noite UTC; retirar ideias não devolve esse limite.`;
    case "disabled": return "Novas ideias e retiradas estão pausadas na configuração telegram_queue. /fila continua disponível para consulta.";
    default: throw new Error("Resultado de fila desconhecido");
  }
}

export async function executeQueueCommand(db: SupabaseClient, updateId: number, chatId: string, userId: string, command: QueueCommand) {
  const { data, error } = await db.rpc("telegram_queue_command", { p_update_id: updateId, p_chat_id: chatId, p_user_id: userId,
    p_command: command.command, p_briefing: command.command === "idea" ? command.briefing : null,
    p_idea_id: command.command === "cancel" ? command.ideaId : null, p_product_url: command.command === "idea" ? command.productUrl : null });
  if (error) throw new AppError("Não foi possível registrar o comando de fila", 500, "DB_ERROR");
  if (data?.duplicate === true) return { duplicate: true };
  let replyStatus = "sent";
  try { await telegramCall("sendMessage", { chat_id: chatId, text: queueReply(data), link_preview_options: { is_disabled: true } }); }
  catch (error) { replyStatus = error instanceof AppError && error.code === "TELEGRAM_REJECTED" ? "failed" : "uncertain"; }
  const saved = await db.from("telegram_commands").update({ reply_status: replyStatus }).eq("update_id", updateId);
  return { ok: true, result: data?.code, reply_status: saved.error ? "uncertain" : replyStatus };
}
