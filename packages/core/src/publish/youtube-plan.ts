import { z } from "zod";
import { validateReviewSnapshot } from "../review/review-packet.ts";

export function youtubePlan(snapshot: unknown, config: unknown, storageOrigin: string,
  target: { variant: "landscape" | "portrait"; privacy: "private" | "public" }) {
  const cfg = z.object({
    max_video_bytes: z.number().int().positive().max(52428800),
    made_for_kids: z.boolean(),
    category_ids: z.record(z.string().regex(/^[1-9][0-9]*$/)),
  }).parse(config);
  const { episode } = validateReviewSnapshot(snapshot);
  const script = episode.script_json;
  const metadata = script.metadata.youtube;
  const categoryId = cfg.category_ids[metadata.category];
  if (!categoryId) throw new Error("Categoria editorial sem mapeamento YouTube");
  // Fail instead of silently changing the approved title/description.
  if (/[<>]/u.test(metadata.title + metadata.description)
    || new TextEncoder().encode(metadata.description).length > 5000) throw new Error("Metadados excedem o contrato YouTube");
  if (target.privacy === "public" && (target.variant !== "portrait" || script.platform_ctas?.youtube.commercial !== false
    || script.disclosures.commercial_content || episode.product_compliance?.affiliate_links?.youtube
    || episode.product_compliance?.affiliate_link)) {
    throw new Error("Short público exige vídeo vertical orgânico aprovado");
  }
  const url = new URL(episode.metadata.render_outputs[target.variant]);
  const storage = new URL(storageOrigin);
  if (storage.protocol !== "https:" || url.origin !== storage.origin || url.search || url.hash || url.username || url.password) {
    throw new Error("Vídeo deve pertencer ao Storage HTTPS configurado");
  }
  const path = new RegExp(`^/storage/v1/object/public/[^/]+/episodes/${episode.id}/render/final/([a-f0-9]{64})/episode_${target.variant}[.]mp4$`);
  const hash = path.exec(url.pathname)?.[1];
  if (!hash) throw new Error("Render sem hash dos bytes; refaça e aprove o render");
  return { url: url.href, hash, maxBytes: cfg.max_video_bytes, body: {
    snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId,
      defaultLanguage: script.narration.language, defaultAudioLanguage: script.narration.language },
    status: { privacyStatus: target.privacy, selfDeclaredMadeForKids: cfg.made_for_kids, containsSyntheticMedia: true },
    paidProductPlacementDetails: { hasPaidProductPlacement: script.disclosures.commercial_content },
  } };
}

export function youtubePrivatePlan(snapshot: unknown, config: unknown, storageOrigin: string) {
  return youtubePlan(snapshot, config, storageOrigin, { variant: "landscape", privacy: "private" });
}
