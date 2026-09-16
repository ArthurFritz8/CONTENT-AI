// ADR-032: cliente Hacker News (Algolia) — busca pública, sem chave, sem custo,
// sem restrição de uso comercial (índice de busca de conteúdo público do HN).

import { z } from "zod";
import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";

const API_URL = "https://hn.algolia.com/api/v1/search";
const hitSchema = z.object({
  title: z.string().trim().min(1).max(500).nullable(),
  url: z.string().url().nullable(),
  objectID: z.string(),
  points: z.number().nullable(),
});
const responseSchema = z.object({ hits: z.array(hitSchema) });

export interface HackerNewsItem {
  title: string;
  url: string;
  objectId: string;
  points: number;
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function hackerNewsSearch(opts: { query: string; maxResults: number }): Promise<HackerNewsItem[]> {
  return await retryWithBackoff(
    async () => {
      const url = new URL(API_URL);
      url.searchParams.set("query", opts.query);
      url.searchParams.set("tags", "story");
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new AppError(
          `Hacker News falhou (${res.status})`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "HACKERNEWS_CALL_FAILED",
        );
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) throw new AppError("Hacker News retornou resposta inválida", 502, "HACKERNEWS_INVALID_RESPONSE");
      const items: HackerNewsItem[] = [];
      for (const hit of parsed.data.hits) {
        if (!hit.title || !hit.url || !isHttps(hit.url)) continue;
        items.push({ title: hit.title, url: hit.url, objectId: hit.objectID, points: hit.points ?? 0 });
        if (items.length >= opts.maxResults) break;
      }
      return items;
    },
    { retries: 1, shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}
