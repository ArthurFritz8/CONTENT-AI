import { z } from "zod";
import { validateReviewSnapshot } from "../review/review-packet.ts";

export function youtubePrivatePlan(snapshot: unknown, config: unknown, storageOrigin: string) {
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
  const url = new URL(episode.metadata.render_outputs.landscape);
  const storage = new URL(storageOrigin);
  if (storage.protocol !== "https:" || url.origin !== storage.origin || url.search || url.hash || url.username || url.password) {
    throw new Error("Vídeo deve pertencer ao Storage HTTPS configurado");
  }
  const path = new RegExp(`^/storage/v1/object/public/[^/]+/episodes/${episode.id}/render/final/([a-f0-9]{64})/episode_landscape[.]mp4$`);
  const hash = path.exec(url.pathname)?.[1];
  if (!hash) throw new Error("Render sem hash dos bytes; refaça e aprove o render");
  return { url: url.href, hash, maxBytes: cfg.max_video_bytes, body: {
    snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags, categoryId,
      defaultLanguage: script.narration.language, defaultAudioLanguage: script.narration.language },
    status: { privacyStatus: "private" as const, selfDeclaredMadeForKids: cfg.made_for_kids, containsSyntheticMedia: true },
    paidProductPlacementDetails: { hasPaidProductPlacement: script.disclosures.commercial_content },
  } };
}
