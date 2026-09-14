import { z } from "zod";
import { AppError, isTransientHttpStatus } from "./error-handler.ts";

const API_ORIGIN = "https://open-api.tiktokglobalshop.com";
const responseEnvelope = z.object({ code: z.number().int(), message: z.string().optional(), request_id: z.string().optional(), data: z.unknown().optional() });

export interface TikTokShopConfig {
  appKey: string;
  appSecret: string;
  creatorAccessToken: string;
  apiOrigin?: string;
}

export interface ProductSearchFilters {
  keywords?: string[];
  pageToken?: string;
  pageSize?: number;
  sortField?: "commission_rate" | "product_sales_price" | "commission" | "units_sold";
  sortOrder?: "ASC" | "DESC";
  minPrice?: string;
  maxPrice?: string;
  minCommissionRate?: string;
  maxCommissionRate?: string;
  categoryId?: string;
}

export interface TikTokShopResponse<T> {
  data: T;
  requestId?: string;
}

function utf8(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

/** TikTok's documented signature: secret + path + sorted query + body + secret. */
export async function signTikTokRequest(secret: string, path: string, query: Record<string, string>, body: string): Promise<string> {
  if (!secret || !path.startsWith("/")) throw new Error("TikTok signature requires secret and absolute path");
  const canonicalQuery = Object.entries(query).filter(([key, value]) => key !== "sign" && key !== "access_token" && value !== "")
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}${value}`).join("");
  const signingString = `${secret}${path}${canonicalQuery}${body}${secret}`;
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, utf8(signingString));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function queryFromFilters(filters: ProductSearchFilters): Record<string, string> {
  const pageSize = filters.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) throw new AppError("TikTok page_size deve estar entre 1 e 20", 422, "INVALID_TIKTOK_QUERY");
  return {
    ...(filters.pageToken ? { page_token: filters.pageToken } : {}), page_size: String(pageSize),
    ...(filters.sortField ? { sort_field: filters.sortField } : {}), ...(filters.sortOrder ? { sort_order: filters.sortOrder } : {}),
  };
}

function bodyFromFilters(filters: ProductSearchFilters): Record<string, unknown> {
  return {
    ...(filters.keywords?.length ? { title_keywords: filters.keywords.slice(0, 20) } : {}),
    ...(filters.minPrice || filters.maxPrice ? { sales_price_range: { ...(filters.minPrice ? { amount_ge: filters.minPrice } : {}), ...(filters.maxPrice ? { amount_lt: filters.maxPrice } : {}) } } : {}),
    ...(filters.minCommissionRate || filters.maxCommissionRate ? { commission_rate_range: { ...(filters.minCommissionRate ? { rate_ge: filters.minCommissionRate } : {}), ...(filters.maxCommissionRate ? { rate_lt: filters.maxCommissionRate } : {}) } } : {}),
    ...(filters.categoryId ? { category: { id: filters.categoryId } } : {}),
  };
}

export class TikTokShopClient {
  constructor(private readonly config: TikTokShopConfig, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  private async request<T>(path: string, method: "GET" | "POST", query: Record<string, string>, body: Record<string, unknown> | null): Promise<TikTokShopResponse<T>> {
    const payload = body ? JSON.stringify(body) : "";
    const allQuery = { app_key: this.config.appKey, timestamp: String(this.now()), ...query };
    const sign = await signTikTokRequest(this.config.appSecret, path, allQuery, payload);
    const url = new URL(`${this.config.apiOrigin ?? API_ORIGIN}${path}`);
    for (const [key, value] of Object.entries({ ...allQuery, sign })) url.searchParams.set(key, value);
    const response = await this.fetcher(url, { method, signal: AbortSignal.timeout(20_000), headers: {
      "content-type": "application/json", "x-tts-access-token": this.config.creatorAccessToken,
    }, body: method === "POST" ? payload : undefined });
    const detail = (await response.text()).slice(0, 500);
    if (!response.ok) throw new AppError(`TikTok Shop respondeu HTTP ${response.status}`, isTransientHttpStatus(response.status) ? 502 : 502, "TIKTOK_SHOP_HTTP_ERROR");
    let parsed: z.infer<typeof responseEnvelope>;
    try { parsed = responseEnvelope.parse(JSON.parse(detail)); } catch { throw new AppError("TikTok Shop retornou JSON inválido", 502, "TIKTOK_SHOP_INVALID_RESPONSE"); }
    if (parsed.code !== 0) throw new AppError(`TikTok Shop recusou a operação (${parsed.code})`, 502, "TIKTOK_SHOP_API_ERROR");
    return { data: parsed.data as T, ...(parsed.request_id ? { requestId: parsed.request_id } : {}) };
  }

  async searchOpenCollaborationProducts(filters: ProductSearchFilters = {}) {
    return this.request<unknown>("/affiliate_creator/202405/open_collaborations/products/search", "POST", queryFromFilters(filters), bodyFromFilters(filters));
  }

  /** `material` follows the current Creator Generate General Link schema. */
  async generateGeneralLink(material: Record<string, unknown>, campaignId?: string, linkType?: string) {
    return this.request<unknown>("/affiliate_creator/202505/affiliate_sharing_links/general_publishers/generate_batch", "POST", {}, {
      material, ...(campaignId ? { campaign_id: campaignId } : {}), ...(linkType ? { link_type: linkType } : {}),
    });
  }
}

export function tiktokShopConfigFromEnv(): TikTokShopConfig {
  const appKey = Deno.env.get("TIKTOK_SHOP_APP_KEY")?.trim();
  const appSecret = Deno.env.get("TIKTOK_SHOP_APP_SECRET")?.trim();
  const creatorAccessToken = Deno.env.get("TIKTOK_SHOP_CREATOR_ACCESS_TOKEN")?.trim();
  if (!appKey || !appSecret || !creatorAccessToken) throw new AppError("Credenciais TikTok Shop ausentes; integração permanece desativada", 503, "TIKTOK_SHOP_NOT_CONFIGURED");
  return { appKey, appSecret, creatorAccessToken };
}
