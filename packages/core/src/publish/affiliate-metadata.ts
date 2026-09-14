import { z } from "zod";

export const DEFAULT_AFFILIATE_DISCLOSURE =
  "Este vídeo contém link de afiliado. Se você comprar pelo link, podemos receber uma comissão.";

const webUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Link de afiliado deve ser HTTPS e não pode conter credenciais");

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
  affiliateLink: string | null | undefined,
  commercial: boolean,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const root = raw as { metadata?: ScriptMetadata; disclosures?: { commercial_disclosure_text?: unknown } & Record<string, unknown> };
  const metadata = root.metadata;
  if (!metadata || !metadata.youtube || !metadata.tiktok || typeof metadata.youtube.description !== "string" ||
    typeof metadata.tiktok.description !== "string") return raw;
  if (!commercial) return raw;

  const link = affiliateLink ? new URL(webUrl.parse(affiliateLink)).href : null;
  const disclosure = typeof root.disclosures?.commercial_disclosure_text === "string" &&
    root.disclosures.commercial_disclosure_text.trim()
    ? root.disclosures.commercial_disclosure_text.trim()
    : DEFAULT_AFFILIATE_DISCLOSURE;
  const suffix = link ? `${disclosure}\nLink do produto: ${link}` : disclosure;
  return {
    ...raw,
    metadata: {
      ...metadata,
      youtube: { ...metadata.youtube, description: addLine(metadata.youtube.description, suffix) },
      tiktok: { ...metadata.tiktok, description: addLine(metadata.tiktok.description, suffix) },
    },
    disclosures: {
      ...(root.disclosures ?? {}),
      commercial_disclosure_text: disclosure,
    },
  };
}
