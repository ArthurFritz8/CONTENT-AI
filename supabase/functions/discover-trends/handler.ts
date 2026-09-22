// discover-trends — sugere pautas via sinais de produto e fontes editoriais
// gratuitas, sem custo de Gemini (ADR-032/034). Nunca cria episódio diretamente: só alimenta idea_queue
// como sugestão de baixa prioridade (source='trend_discovery'), sujeita à mesma
// revisão humana e ao mesmo cap diário que qualquer outra ideia da fila.

import { requireServiceRole } from "../_shared/auth.ts";
import {
  AppError,
  jsonResponse,
  toErrorResponse,
} from "../_shared/error-handler.ts";
import {
  createServiceClient,
  getSystemConfig,
} from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import {
  reserveTavilyCall,
  reserveTrendSourceCall,
} from "../_shared/budget-guard.ts";
import { tavilySearch } from "../_shared/tavily.ts";
import { hackerNewsSearch } from "../_shared/hackernews.ts";
import { socialCrawlSearch } from "../_shared/socialcrawl.ts";
import {
  TRENDS_MCP_SOURCE_URL,
  trendsMcpHotProducts,
} from "../_shared/trends-mcp.ts";

interface TrendDiscoveryConfig {
  enabled?: boolean;
  max_pending?: number;
  query?: string | null;
}

interface NicheConfig {
  name?: string;
  focus?: string;
}

interface SourceConfig {
  enabled?: boolean;
  max_requests_per_day?: number;
  max_results?: number;
  region?: string;
}

interface TrendSourcesConfig {
  socialcrawl?: SourceConfig;
  trends_mcp?: SourceConfig;
}

interface Candidate {
  title: string;
  sourceUrl: string;
  dedupeKey: string;
  provider: "socialcrawl" | "trends_mcp" | "tavily" | "hackernews";
}

function dedupeKeyFrom(url: string): string {
  return url.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/$/, "");
}

function titleDedupeKey(provider: string, title: string): string {
  return `${provider}:${
    title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(
      /^-|-$/g,
      "",
    ).slice(0, 180)
  }`;
}

function errorCode(err: unknown): string {
  return err instanceof AppError ? err.code : "UNKNOWN_ERROR";
}

export async function handleDiscoverTrends(req: Request): Promise<Response> {
  try {
    requireServiceRole(req);
  } catch (err) {
    return toErrorResponse(err);
  }
  if (req.method !== "POST") {
    return toErrorResponse(
      new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"),
    );
  }

  const db = createServiceClient();
  const logger = new JobLogger(db, "discover-trends");
  try {
    const cfg = await getSystemConfig<TrendDiscoveryConfig>(
      db,
      "trend_discovery",
      {},
    );
    if (!cfg.enabled) {
      return jsonResponse({ paused: true, reason: "trend_discovery_disabled" });
    }

    const maxPending = Math.min(20, Math.max(1, cfg.max_pending ?? 5));
    const { count, error: countError } = await db
      .from("idea_queue")
      .select("id", { count: "exact", head: true })
      .eq("source", "trend_discovery")
      .eq("status", "pending");
    if (countError) {
      throw new AppError(
        `Erro ao contar sugestões pendentes: ${countError.message}`,
        500,
        "DB_ERROR",
      );
    }
    const alreadyPending = count ?? 0;
    if (alreadyPending >= maxPending) {
      return jsonResponse({
        created: 0,
        reason: "max_pending_reached",
        pending: alreadyPending,
      });
    }

    const niche = await getSystemConfig<NicheConfig>(db, "niche", {});
    const sources = await getSystemConfig<TrendSourcesConfig>(
      db,
      "trend_sources",
      {},
    );
    const query =
      (cfg.query?.trim() || niche.focus || "gadgets e produtos inovadores")
        .slice(0, 200);
    const attempts: Array<
      { source: string; outcome: string; count?: number; code?: string }
    > = [];
    let candidates: Candidate[] = [];

    if (sources.socialcrawl?.enabled) {
      try {
        const found = await socialCrawlSearch({
          query,
          region: sources.socialcrawl.region ?? "BR",
          maxResults: sources.socialcrawl.max_results ?? 5,
          beforeRequest: () =>
            reserveTrendSourceCall(db, logger, "socialcrawl"),
        });
        candidates = found.map((item) => ({
          title: item.title,
          sourceUrl: item.productUrl ??
            "https://www.socialcrawl.dev/docs/tiktokshop",
          dedupeKey: item.productUrl
            ? dedupeKeyFrom(item.productUrl)
            : titleDedupeKey("socialcrawl", item.productId ?? item.title),
          provider: "socialcrawl",
        }));
        attempts.push({
          source: "socialcrawl",
          outcome: candidates.length ? "selected" : "empty",
          count: candidates.length,
        });
      } catch (err) {
        attempts.push({
          source: "socialcrawl",
          outcome: "failed",
          code: errorCode(err),
        });
        logger.info("fonte de tendências indisponível", {
          source: "socialcrawl",
          code: errorCode(err),
        });
      }
    }

    if (!candidates.length && sources.trends_mcp?.enabled) {
      try {
        const found = await trendsMcpHotProducts({
          maxResults: sources.trends_mcp.max_results ?? 5,
          beforeRequest: () => reserveTrendSourceCall(db, logger, "trends_mcp"),
        });
        candidates = found.map((item) => ({
          title: item.title,
          sourceUrl: item.url ?? TRENDS_MCP_SOURCE_URL,
          dedupeKey: titleDedupeKey("trends_mcp", item.title),
          provider: "trends_mcp",
        }));
        attempts.push({
          source: "trends_mcp",
          outcome: candidates.length ? "selected" : "empty",
          count: candidates.length,
        });
      } catch (err) {
        attempts.push({
          source: "trends_mcp",
          outcome: "failed",
          code: errorCode(err),
        });
        logger.info("fonte de tendências indisponível", {
          source: "trends_mcp",
          code: errorCode(err),
        });
      }
    }

    // Camada editorial: mantém a rotação diária já decidida no ADR-032, mas
    // tenta a outra fonte se a preferida falhar ou vier vazia.
    if (!candidates.length) {
      const preferTavily = new Date().getUTCDate() % 2 === 0;
      const editorialOrder = preferTavily
        ? ["tavily", "hackernews"] as const
        : ["hackernews", "tavily"] as const;
      for (const source of editorialOrder) {
        try {
          if (source === "tavily") {
            const search = await tavilySearch({
              query: `${query} lançamento tendência novidade`,
              maxResults: 5,
              beforeRequest: () => reserveTavilyCall(db, logger),
            });
            candidates = search.sources.map((item) => ({
              title: item.title,
              sourceUrl: item.url,
              dedupeKey: dedupeKeyFrom(item.url),
              provider: "tavily",
            }));
          } else {
            const hits = await hackerNewsSearch({ query, maxResults: 5 });
            candidates = hits.map((item) => ({
              title: item.title,
              sourceUrl: item.url,
              dedupeKey: dedupeKeyFrom(item.url),
              provider: "hackernews",
            }));
          }
          attempts.push({
            source,
            outcome: candidates.length ? "selected" : "empty",
            count: candidates.length,
          });
          if (candidates.length) break;
        } catch (err) {
          attempts.push({ source, outcome: "failed", code: errorCode(err) });
          logger.info("fonte editorial indisponível", {
            source,
            code: errorCode(err),
          });
        }
      }
    }

    if (!candidates.length) {
      await logger.event({
        event_type: "trend_discovered",
        metadata: { source: null, created: 0, attempts },
      });
      return jsonResponse({ created: 0, reason: "no_candidates", attempts });
    }

    const nicheName = niche.name ?? "gadgets_produtos_inovadores";
    const budget = maxPending - alreadyPending;
    let created = 0;
    for (const candidate of candidates) {
      if (created >= budget) break;
      const briefing =
        `Candidato não confirmado (${candidate.provider}): "${candidate.title}". Fonte: ${candidate.sourceUrl}. ` +
        "Pesquisar o produto/tema real por trás dessa tendência e criar um vídeo no nicho de gadgets e produtos " +
        "inovadores — mostrar o problema que resolve e uma demonstração de uso. Validar manualmente disponibilidade no " +
        "Brasil, elegibilidade, comissão e vínculo afiliado antes de aprovar. Esta sugestão não é um produto afiliado confirmado.";
      const { error: insertError } = await db.from("idea_queue").insert({
        briefing,
        niche: nicheName,
        category: "trend_discovery",
        source: "trend_discovery",
        priority: 500, // menor prioridade que pautas manuais (default 100) — humano sempre vem primeiro
        dedupe_key: candidate.dedupeKey,
      });
      if (insertError) {
        if (insertError.code === "23505") continue; // já descoberto antes nesta URL
        throw new AppError(
          `Erro ao registrar sugestão: ${insertError.message}`,
          500,
          "DB_ERROR",
        );
      }
      created += 1;
    }

    await logger.event({
      event_type: "trend_discovered",
      metadata: {
        source: candidates[0]?.provider,
        created,
        candidates: candidates.length,
        pending_before: alreadyPending,
        attempts,
      },
    });
    return jsonResponse(
      { created, source: candidates[0]?.provider, attempts },
      created > 0 ? 201 : 200,
    );
  } catch (err) {
    logger.error("falha no discover-trends", err);
    return toErrorResponse(err);
  }
}
