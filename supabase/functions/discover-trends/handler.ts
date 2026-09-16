// discover-trends — sugere pautas via Tavily + Hacker News, gratuitos, sem custo
// de Gemini (ADR-032). Nunca cria episódio diretamente: só alimenta idea_queue
// como sugestão de baixa prioridade (source='trend_discovery'), sujeita à mesma
// revisão humana e ao mesmo cap diário que qualquer outra ideia da fila.

import { requireServiceRole } from "../_shared/auth.ts";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { reserveTavilyCall } from "../_shared/budget-guard.ts";
import { tavilySearch } from "../_shared/tavily.ts";
import { hackerNewsSearch } from "../_shared/hackernews.ts";

interface TrendDiscoveryConfig {
  enabled?: boolean;
  max_pending?: number;
  query?: string | null;
}

interface NicheConfig {
  name?: string;
  focus?: string;
}

interface Candidate {
  title: string;
  url: string;
}

function dedupeKeyFrom(url: string): string {
  return url.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

export async function handleDiscoverTrends(req: Request): Promise<Response> {
  try {
    requireServiceRole(req);
  } catch (err) {
    return toErrorResponse(err);
  }
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  const db = createServiceClient();
  const logger = new JobLogger(db, "discover-trends");
  try {
    const cfg = await getSystemConfig<TrendDiscoveryConfig>(db, "trend_discovery", {});
    if (!cfg.enabled) return jsonResponse({ paused: true, reason: "trend_discovery_disabled" });

    const maxPending = Math.min(20, Math.max(1, cfg.max_pending ?? 5));
    const { count, error: countError } = await db
      .from("idea_queue")
      .select("id", { count: "exact", head: true })
      .eq("source", "trend_discovery")
      .eq("status", "pending");
    if (countError) throw new AppError(`Erro ao contar sugestões pendentes: ${countError.message}`, 500, "DB_ERROR");
    const alreadyPending = count ?? 0;
    if (alreadyPending >= maxPending) {
      return jsonResponse({ created: 0, reason: "max_pending_reached", pending: alreadyPending });
    }

    const niche = await getSystemConfig<NicheConfig>(db, "niche", {});
    const query = (cfg.query?.trim() || niche.focus || "gadgets e produtos inovadores").slice(0, 200);
    // Intercala as duas fontes gratuitas por dia — nenhuma delas fica sobrecarregada.
    const useTavily = new Date().getUTCDate() % 2 === 0;

    let candidates: Candidate[];
    let sourceUsed: "tavily" | "hackernews";
    if (useTavily) {
      sourceUsed = "tavily";
      const search = await tavilySearch({
        query: `${query} lançamento tendência novidade`,
        maxResults: 5,
        beforeRequest: () => reserveTavilyCall(db, logger),
      });
      candidates = search.sources.map((s) => ({ title: s.title, url: s.url }));
    } else {
      sourceUsed = "hackernews";
      const hits = await hackerNewsSearch({ query, maxResults: 5 });
      candidates = hits.map((h) => ({ title: h.title, url: h.url }));
    }

    const nicheName = niche.name ?? "gadgets_produtos_inovadores";
    const budget = maxPending - alreadyPending;
    let created = 0;
    for (const candidate of candidates) {
      if (created >= budget) break;
      const briefing = `Tendência descoberta (${sourceUsed}): "${candidate.title}". Fonte: ${candidate.url}. ` +
        "Pesquisar o produto/tema real por trás dessa tendência e criar um vídeo no nicho de gadgets e produtos " +
        "inovadores — mostrar o problema que resolve e uma demonstração de uso. Validar se é mesmo um produto/gadget " +
        "coerente com o canal antes de aprovar.";
      const { error: insertError } = await db.from("idea_queue").insert({
        briefing,
        niche: nicheName,
        category: "trend_discovery",
        source: "trend_discovery",
        priority: 500, // menor prioridade que pautas manuais (default 100) — humano sempre vem primeiro
        dedupe_key: dedupeKeyFrom(candidate.url),
      });
      if (insertError) {
        if (insertError.code === "23505") continue; // já descoberto antes nesta URL
        throw new AppError(`Erro ao registrar sugestão: ${insertError.message}`, 500, "DB_ERROR");
      }
      created += 1;
    }

    await logger.event({
      event_type: "trend_discovered",
      metadata: { source: sourceUsed, created, candidates: candidates.length, pending_before: alreadyPending },
    });
    return jsonResponse({ created, source: sourceUsed }, created > 0 ? 201 : 200);
  } catch (err) {
    logger.error("falha no discover-trends", err);
    return toErrorResponse(err);
  }
}
