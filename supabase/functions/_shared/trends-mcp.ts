import { z } from "zod";
import {
  AppError,
  isTransientHttpStatus,
  retryWithBackoff,
} from "./error-handler.ts";

const API_URL = "https://api.trendsmcp.ai/api";
export const TRENDS_MCP_SOURCE_URL = "https://www.trendsmcp.ai/docs/mcp";
const TRENDS_MCP_FEED = "Amazon Best Sellers Top Rated";

const trendSchema = z.object({
  title: z.string().trim().min(1).max(1_000).optional(),
  name: z.string().trim().min(1).max(1_000).optional(),
  topic: z.string().trim().min(1).max(1_000).optional(),
  keyword: z.string().trim().min(1).max(1_000).optional(),
  product: z.string().trim().min(1).max(1_000).optional(),
  url: z.string().optional(),
  rank: z.number().int().positive().optional(),
}).passthrough();
const positionalTrendSchema = z.array(z.unknown()).min(2).max(50);
const trendListSchema = z.array(z.union([trendSchema, positionalTrendSchema]))
  .max(200);
const responseSchema = z.union([
  trendListSchema,
  z.object({
    data: trendListSchema.optional(),
    trends: trendListSchema.optional(),
    results: trendListSchema.optional(),
    items: trendListSchema.optional(),
  }).passthrough(),
]);
const envelopeSchema = z.object({
  statusCode: z.number().int(),
  body: z.unknown(),
}).passthrough();

export interface TrendsMcpCandidate {
  title: string;
  url: string | null;
  rank: number | null;
}

function apiKey(): string {
  const value = Deno.env.get("TRENDS_MCP_API_KEY")?.trim();
  if (!value) {
    throw new AppError(
      "TRENDS_MCP_API_KEY ausente no ambiente",
      500,
      "CONFIG_MISSING",
    );
  }
  return value;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function unwrapPayload(raw: unknown): unknown {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return raw;
  if (envelope.data.statusCode < 200 || envelope.data.statusCode >= 300) {
    throw new AppError(
      `Trends MCP falhou internamente (${envelope.data.statusCode})`,
      502,
      "TRENDS_MCP_CALL_FAILED",
    );
  }
  if (typeof envelope.data.body !== "string") return envelope.data.body;
  try {
    return JSON.parse(envelope.data.body);
  } catch {
    throw new AppError(
      "Trends MCP retornou envelope inválido",
      502,
      "TRENDS_MCP_INVALID_RESPONSE",
    );
  }
}

export async function trendsMcpHotProducts(opts: {
  maxResults: number;
  beforeRequest: () => Promise<void>;
}): Promise<TrendsMcpCandidate[]> {
  const key = apiKey();
  return await retryWithBackoff(async () => {
    await opts.beforeRequest();
    const response = await fetch(API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "get_top_trends",
        type: TRENDS_MCP_FEED,
        limit: Math.min(20, Math.max(1, opts.maxResults)),
      }),
    });
    if (!response.ok) {
      throw new AppError(
        `Trends MCP falhou (${response.status})`,
        isTransientHttpStatus(response.status) ? 502 : 500,
        "TRENDS_MCP_CALL_FAILED",
      );
    }
    const parsed = responseSchema.safeParse(
      unwrapPayload(await response.json()),
    );
    if (!parsed.success) {
      throw new AppError(
        "Trends MCP retornou resposta inválida",
        502,
        "TRENDS_MCP_INVALID_RESPONSE",
      );
    }
    const values = Array.isArray(parsed.data)
      ? parsed.data
      : parsed.data.data ?? parsed.data.trends ?? parsed.data.results ??
        parsed.data.items ?? [];
    const candidates: TrendsMcpCandidate[] = [];
    for (const trend of values) {
      if (Array.isArray(trend)) {
        const rawRank = trend[0];
        const rawTitle = trend[1];
        if (typeof rawTitle !== "string" || !rawTitle.trim()) continue;
        candidates.push({
          title: rawTitle.trim().slice(0, 1_000),
          url: null,
          rank: typeof rawRank === "number" && Number.isInteger(rawRank) &&
              rawRank > 0
            ? rawRank
            : null,
        });
        if (candidates.length >= Math.min(20, Math.max(1, opts.maxResults))) {
          break;
        }
        continue;
      }
      const title = trend.title ?? trend.name ?? trend.topic ?? trend.keyword ??
        trend.product;
      if (!title) continue;
      candidates.push({
        title,
        url: httpsUrl(trend.url),
        rank: trend.rank ?? null,
      });
      if (candidates.length >= Math.min(20, Math.max(1, opts.maxResults))) {
        break;
      }
    }
    return candidates;
  }, {
    retries: 1,
    shouldRetry: (error) => error instanceof AppError && error.status === 502,
  });
}
