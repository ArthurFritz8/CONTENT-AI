import { z } from "zod";

export const DEFAULT_AFFILIATE_DISCLOSURE =
  "Este vídeo contém link de afiliado. Se você comprar pelo link, podemos receber uma comissão.";

const webUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Link de afiliado deve ser HTTPS e não pode conter credenciais");

export const affiliateLinksSchema = z.object({
  youtube: webUrl.optional(),
  tiktok: webUrl.optional(),
}).strict();

export type AffiliateLinks = z.infer<typeof affiliateLinksSchema>;

/**
 * Reads the platform map owned by the system. Historical episodes only had
 * affiliate_link; that legacy value is treated as YouTube because YouTube was
 * the only automated publisher when the old field existed.
 */
export function affiliateLinksFromCompliance(raw: unknown): AffiliateLinks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const links = value.affiliate_links === undefined
    ? {}
    : affiliateLinksSchema.parse(value.affiliate_links);
  if (Object.keys(links).length) return links;
  if (typeof value.affiliate_link === "string") {
    return { youtube: webUrl.parse(value.affiliate_link) };
  }
  return {};
}

export function affiliateLinkForPlatform(
  raw: unknown,
  platform: keyof AffiliateLinks,
): string | null {
  return affiliateLinksFromCompliance(raw)[platform] ?? null;
}

interface ChannelMetadata {
  description: string;
  [key: string]: unknown;
}

interface ScriptMetadata {
  youtube: ChannelMetadata;
  tiktok: ChannelMetadata;
  [key: string]: unknown;
}

function addLine(text: string, line: string): string {
  const normalized = text.normalize("NFC");
  return normalized.includes(line) ? normalized : `${normalized.trim()}\n\n${line}`;
}

/**
 * Product links are system-owned metadata. The model may write the copy, but
 * it cannot accidentally omit the URL or the commercial disclosure.
 */
export function applyAffiliateMetadata(
  raw: unknown,
  affiliateLinks: AffiliateLinks,
  commercial: boolean,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const root = raw as { platform_ctas?: unknown; metadata?: ScriptMetadata; disclosures?: { commercial_disclosure_text?: unknown } & Record<string, unknown> };
  const metadata = root.metadata;
  if (!metadata || !metadata.youtube || !metadata.tiktok || typeof metadata.youtube.description !== "string" ||
    typeof metadata.tiktok.description !== "string") return raw;
  if (!commercial) return raw;

  const links = affiliateLinksSchema.parse(affiliateLinks);
  const disclosure = typeof root.disclosures?.commercial_disclosure_text === "string" &&
    root.disclosures.commercial_disclosure_text.trim()
    ? root.disclosures.commercial_disclosure_text.trim()
    : DEFAULT_AFFILIATE_DISCLOSURE;
  const suffix = (link?: string) =>
    link
      ? `${disclosure}\nLink do produto: ${new URL(link).href}`
      : disclosure;
  return {
    ...raw,
    metadata: {
      ...metadata,
      youtube: {
        ...metadata.youtube,
        description: addLine(metadata.youtube.description, suffix(links.youtube)),
      },
      tiktok: {
        ...metadata.tiktok,
        description: root.platform_ctas ? metadata.tiktok.description : addLine(metadata.tiktok.description, suffix(links.tiktok)),
      },
    },
    disclosures: {
      ...(root.disclosures ?? {}),
      commercial_disclosure_text: disclosure,
    },
  };
}
