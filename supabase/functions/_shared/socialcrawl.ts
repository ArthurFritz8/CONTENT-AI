import { z } from "zod";
import {
  AppError,
  isTransientHttpStatus,
  retryWithBackoff,
} from "./error-handler.ts";

const API_URL = "https://www.socialcrawl.dev/v1/tiktokshop/search";

const productSchema = z.object({
  product_id: z.union([z.string(), z.number()]).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().trim().min(1).max(1_000).optional(),
  name: z.string().trim().min(1).max(1_000).optional(),
  url: z.string().optional(),
  product_url: z.string().optional(),
  image_url: z.string().optional(),
  cover_image_url: z.string().optional(),
  images: z.array(z.unknown()).optional(),
}).passthrough();

const productListSchema = z.array(productSchema).max(200);
const responseSchema = z.object({
  data: z.union([
    productListSchema,
    z.object({
      products: productListSchema.optional(),
      items: productListSchema.optional(),
      results: productListSchema.optional(),
    }).passthrough(),
  ]).optional(),
  products: productListSchema.optional(),
  items: productListSchema.optional(),
  results: productListSchema.optional(),
}).passthrough();

export interface SocialCrawlProductCandidate {
  title: string;
  productId: string | null;
  productUrl: string | null;
  imageUrl: string | null;
}

function apiKey(): string {
  const value = Deno.env.get("SOCIALCRAWL_API_KEY")?.trim();
  if (!value) {
    throw new AppError(
      "SOCIALCRAWL_API_KEY ausente no ambiente",
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

function firstImage(product: z.infer<typeof productSchema>): string | null {
  const direct = httpsUrl(product.image_url) ??
    httpsUrl(product.cover_image_url);
  if (direct) return direct;
  for (const item of product.images ?? []) {
    if (typeof item === "string") {
      const url = httpsUrl(item);
      if (url) return url;
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const url = httpsUrl(record.url) ?? httpsUrl(record.image_url);
      if (url) return url;
    }
  }
  return null;
}

function productsFromResponse(
  parsed: z.infer<typeof responseSchema>,
): z.infer<typeof productListSchema> {
  if (Array.isArray(parsed.data)) return parsed.data;
  if (parsed.data && !Array.isArray(parsed.data)) {
    return parsed.data.products ?? parsed.data.items ?? parsed.data.results ??
      [];
  }
  return parsed.products ?? parsed.items ?? parsed.results ?? [];
}

export async function socialCrawlSearch(opts: {
  query: string;
  region: string;
  maxResults: number;
  beforeRequest: () => Promise<void>;
}): Promise<SocialCrawlProductCandidate[]> {
  const key = apiKey();
  return await retryWithBackoff(async () => {
    await opts.beforeRequest();
    const url = new URL(API_URL);
    url.searchParams.set("query", opts.query.slice(0, 200));
    url.searchParams.set("region", opts.region.toUpperCase());
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { "x-api-key": key, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new AppError(
        `SocialCrawl falhou (${response.status})`,
        isTransientHttpStatus(response.status) ? 502 : 500,
        "SOCIALCRAWL_CALL_FAILED",
      );
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new AppError(
        "SocialCrawl retornou resposta inválida",
        502,
        "SOCIALCRAWL_INVALID_RESPONSE",
      );
    }
    const candidates: SocialCrawlProductCandidate[] = [];
    for (const product of productsFromResponse(parsed.data)) {
      const title = product.title?.trim() || product.name?.trim();
      if (!title) continue;
      const productUrl = httpsUrl(product.product_url) ?? httpsUrl(product.url);
      const rawId = product.product_id ?? product.id;
      candidates.push({
        title,
        productId: rawId === undefined ? null : String(rawId),
        productUrl,
        imageUrl: firstImage(product),
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
