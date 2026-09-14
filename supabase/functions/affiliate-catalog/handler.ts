import { z } from "zod";
import { AppError, jsonResponse, toErrorResponse } from "../_shared/error-handler.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { createServiceClient } from "../_shared/supabase-client.ts";
import { parseJsonBody } from "../_shared/validators.ts";
import { TikTokShopClient, tiktokShopConfigFromEnv } from "../_shared/tiktok-shop.ts";

const inputSchema = z.object({
  action: z.enum(["search", "generate_link"]).default("search"),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  page_token: z.string().max(512).optional(),
  page_size: z.number().int().min(1).max(20).optional(),
  sort_field: z.enum(["commission_rate", "product_sales_price", "commission", "units_sold"]).optional(),
  sort_order: z.enum(["ASC", "DESC"]).optional(),
  min_price: z.string().max(32).optional(),
  max_price: z.string().max(32).optional(),
  min_commission_rate: z.string().max(32).optional(),
  max_commission_rate: z.string().max(32).optional(),
  category_id: z.string().max(64).optional(),
  material: z.record(z.unknown()).optional(),
  campaign_id: z.string().max(128).optional(),
  link_type: z.string().max(64).optional(),
});

type ProductRow = {
  provider: "tiktok_shop";
  external_product_id: string;
  title: string;
  product_url: string | null;
  affiliate_url: string | null;
  image_url: string | null;
  currency: string | null;
  price: number | null;
  commission_rate: number | null;
  units_sold: number | null;
  category_id: string | null;
  raw_data: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function productList(data: unknown): Record<string, unknown>[] {
  const root = asRecord(data);
  for (const key of ["products", "product_list", "items", "results"]) {
    const values = root[key];
    if (Array.isArray(values)) return values.map(asRecord);
  }
  return Array.isArray(data) ? data.map(asRecord) : [];
}

function normalizeProduct(raw: Record<string, unknown>): ProductRow | null {
  const id = firstString(raw, ["product_id", "id", "item_id"]);
  const title = firstString(raw, ["title", "product_name", "name"]);
  if (!id || !title) return null;
  const image = firstString(raw, ["image_url", "main_image_url", "cover_image_url", "thumbnail_url"]);
  return {
    provider: "tiktok_shop",
    external_product_id: id,
    title,
    product_url: firstString(raw, ["product_url", "detail_url", "url"]),
    affiliate_url: firstString(raw, ["affiliate_url", "share_url", "promotion_url"]),
    image_url: image,
    currency: firstString(raw, ["currency", "currency_code"]),
    price: firstNumber(raw, ["price", "sale_price", "product_sales_price"]),
    commission_rate: firstNumber(raw, ["commission_rate", "commissionRate"]),
    units_sold: firstNumber(raw, ["units_sold", "sales", "sold_count"]),
    category_id: firstString(raw, ["category_id", "categoryId"]),
    raw_data: raw,
  };
}

function nextPageToken(data: unknown): string | null {
  const root = asRecord(data);
  return firstString(root, ["next_page_token", "nextPageToken", "page_token"]);
}

export async function handleAffiliateCatalog(req: Request): Promise<Response> {
  try {
    requireServiceRole(req);
    if (req.method !== "POST") throw new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED");
    const input = await parseJsonBody(req, inputSchema);
    const client = new TikTokShopClient(tiktokShopConfigFromEnv());

    if (input.action === "generate_link") {
      if (!input.material) throw new AppError("material é obrigatório para gerar o link", 422, "MATERIAL_REQUIRED");
      const result = await client.generateGeneralLink(input.material, input.campaign_id, input.link_type);
      return jsonResponse({ provider: "tiktok_shop", action: input.action, data: result.data, request_id: result.requestId });
    }

    const result = await client.searchOpenCollaborationProducts({
      keywords: input.keywords, pageToken: input.page_token, pageSize: input.page_size,
      sortField: input.sort_field, sortOrder: input.sort_order, minPrice: input.min_price,
      maxPrice: input.max_price, minCommissionRate: input.min_commission_rate,
      maxCommissionRate: input.max_commission_rate, categoryId: input.category_id,
    });
    const products = productList(result.data).map(normalizeProduct).filter((item): item is ProductRow => item !== null);
    const db = createServiceClient();
    if (products.length) {
      const { error } = await db.from("affiliate_products").upsert(products, { onConflict: "provider,external_product_id" });
      if (error) throw new AppError("Não foi possível salvar o catálogo", 500, "DB_ERROR");
    }
    return jsonResponse({ provider: "tiktok_shop", action: input.action, count: products.length,
      next_page_token: nextPageToken(result.data), products, request_id: result.requestId });
  } catch (err) { return toErrorResponse(err); }
}
