import { z } from "zod";
import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";

const API_URL = "https://api.tavily.com/search";
const resultSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().url(),
  content: z.string().trim().min(1).max(100_000),
  score: z.number().min(0).max(1),
});
const responseSchema = z.object({
  query: z.string().trim().min(1),
  request_id: z.string().optional(),
  results: z.array(resultSchema).min(1).max(20),
  usage: z.object({ credits: z.number().nonnegative() }).optional(),
});

export type TavilySource = z.infer<typeof resultSchema>;
export interface TavilySearchResult {
  query: string;
  requestId?: string;
  sources: TavilySource[];
  credits: number;
}

function apiKey(): string {
  const value = Deno.env.get("TAVILY_API_KEY")?.trim();
  if (!value) throw new AppError("TAVILY_API_KEY ausente no ambiente", 500, "CONFIG_MISSING");
  return value;
}

function safeSource(source: TavilySource): boolean {
  const url = new URL(source.url);
  return url.protocol === "https:" && !url.username && !url.password;
}

export async function tavilySearch(opts: {
  query: string;
  maxResults: number;
  beforeRequest: () => Promise<void>;
}): Promise<TavilySearchResult> {
  const key = apiKey();
  return await retryWithBackoff(async () => {
    await opts.beforeRequest();
    const response = await fetch(API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: opts.query,
        topic: "general",
        search_depth: "basic",
        max_results: Math.min(8, Math.max(3, opts.maxResults)),
        include_answer: false,
        include_images: false,
        include_raw_content: false,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new AppError(`Tavily falhou (${response.status}): ${detail}`,
        isTransientHttpStatus(response.status) ? 502 : 500, "TAVILY_CALL_FAILED");
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new AppError("Tavily retornou resposta inválida", 502, "TAVILY_INVALID_RESPONSE");
    const sources = parsed.data.results.filter(source => safeSource(source) && source.content.length >= 20)
      .map(source => ({ ...source, content: source.content.slice(0, 12_000) })).slice(0, opts.maxResults);
    if (!sources.length) throw new AppError("Tavily não encontrou fontes HTTPS utilizáveis", 502, "TAVILY_NO_SOURCES");
    return {
      query: parsed.data.query,
      ...(parsed.data.request_id ? { requestId: parsed.data.request_id } : {}),
      sources,
      credits: parsed.data.usage?.credits ?? 1,
    };
  }, { retries: 1, shouldRetry: error => error instanceof AppError && error.status === 502 });
}
