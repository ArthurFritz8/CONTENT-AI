import { z } from "zod";
import { validateReviewSnapshot } from "../review/review-packet.ts";

const qualitySchema = z.object({
  decode_verified: z.literal(true),
  duration_seconds: z.number().finite().min(3).max(600),
  size_bytes: z.number().int().positive().max(1_000_000_000),
  width: z.number().int().min(360),
  height: z.number().int().min(360),
});

/** Buffer accepts one public, persistent video URL and publishes it at the next queue slot. */
export function bufferTikTokPlan(snapshot: unknown, storageOrigin: string) {
  const { episode } = validateReviewSnapshot(snapshot);
  const script = episode.script_json;
  const organic = episode.metadata.render_outputs.platforms?.tiktok;
  if (
    !organic || organic.commercial !== false ||
    script.platform_ctas?.tiktok.commercial !== false ||
    script.disclosures.commercial_content ||
    episode.product_compliance?.affiliate_links?.tiktok
  ) {
    throw new Error(
      "Buffer requer a versão TikTok orgânica aprovada, sem link comercial",
    );
  }
  const quality = qualitySchema.parse(organic.quality);
  if (quality.height <= quality.width) {
    throw new Error("O vídeo TikTok precisa ser vertical");
  }
  const caption = `${script.metadata.tiktok.description.trim()} ${
    script.metadata.tiktok.hashtags.join(" ")
  }`.trim();
  if (!caption || caption.length > 2200) {
    throw new Error("Legenda TikTok excede 2.200 unidades UTF-16");
  }
  const url = new URL(organic.portrait);
  const storage = new URL(storageOrigin);
  if (
    storage.protocol !== "https:" || url.origin !== storage.origin ||
    url.search || url.hash || url.username || url.password ||
    !new RegExp(
      `^/storage/v1/object/public/[^/]+/episodes/${episode.id}/render/final/[a-f0-9]{64}/episode_portrait[.]mp4$`,
    ).test(url.pathname)
  ) {
    throw new Error(
      "Buffer requer o render imutável e público do Storage HTTPS",
    );
  }
  return {
    episodeId: episode.id,
    videoUrl: url.href,
    caption,
    isAiGenerated: true,
  };
}
