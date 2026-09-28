import { z } from "zod";
import { validateReviewSnapshot } from "../review/review-packet.ts";
import { youtubePlan } from "./youtube-plan.ts";

const portraitQuality = z.object({
  decode_verified: z.literal(true),
  duration_seconds: z.number().finite().positive().max(180),
  size_bytes: z.number().int().positive().max(10_000_000_000),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** Buffer publishes only a public, organic 9:16 Short from the approved immutable render. */
export function bufferYoutubePlan(snapshot: unknown, config: unknown, storageOrigin: string) {
  const { episode } = validateReviewSnapshot(snapshot);
  const plan = youtubePlan(snapshot, config, storageOrigin, { variant: "portrait", privacy: "public" });
  const outputs = episode.metadata.render_outputs;
  const quality = portraitQuality.parse(z.object({ quality: z.object({ portrait: z.unknown() }) })
    .parse(outputs).quality.portrait);
  if (quality.width * 16 !== quality.height * 9) {
    throw new Error("Buffer exige Short com proporção exata de 9:16");
  }
  const title = plan.body.snippet.title.trim();
  const description = plan.body.snippet.description.trim();
  if (!title || Array.from(title).length > 100 || !description || description.length > 5000) {
    throw new Error("Título ou descrição fora do limite do YouTube");
  }
  return { episodeId: episode.id, videoUrl: plan.url, title, description,
    categoryId: plan.body.snippet.categoryId, madeForKids: plan.body.status.selfDeclaredMadeForKids };
}
