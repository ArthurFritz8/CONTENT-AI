import { z } from "zod";
import { validateReviewSnapshot } from "../review/review-packet.ts";

export const tiktokCreatorInfoSchema = z.object({
  creator_username: z.string().min(1),
  privacy_level_options: z.array(z.enum([
    "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY",
  ])).min(1),
  comment_disabled: z.boolean(), duet_disabled: z.boolean(), stitch_disabled: z.boolean(),
  max_video_post_duration_sec: z.number().int().positive(),
});
export type TiktokCreatorInfo = z.infer<typeof tiktokCreatorInfoSchema>;
export const tiktokSelectionSchema = z.object({
  privacy_level: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]),
  title: z.string().min(1).max(2200),
  allow_comment: z.boolean(), allow_duet: z.boolean(), allow_stitch: z.boolean(),
  music_usage_consent: z.literal(true),
});
export type TiktokSelection = z.infer<typeof tiktokSelectionSchema>;

/** A new creator-info query and an explicit per-post selection must precede this plan. */
export function tiktokDirectPostPlan(snapshot: unknown, storageOrigin: string,
  creatorInput: unknown, selectionInput: unknown) {
  const creator = tiktokCreatorInfoSchema.parse(creatorInput);
  const choice = tiktokSelectionSchema.parse(selectionInput);
  const { episode } = validateReviewSnapshot(snapshot);
  const script = episode.script_json;
  const organic = episode.metadata.render_outputs.platforms?.tiktok;
  if (!organic || organic.commercial !== false || script.platform_ctas?.tiktok.commercial !== false
    || script.disclosures.commercial_content || episode.product_compliance?.affiliate_links?.tiktok) {
    throw new Error("Publicação TikTok requer a versão orgânica aprovada");
  }
  if (!creator.privacy_level_options.includes(choice.privacy_level)) throw new Error("Privacidade TikTok indisponível para esta conta");
  if (choice.allow_comment && creator.comment_disabled || choice.allow_duet && creator.duet_disabled
    || choice.allow_stitch && creator.stitch_disabled) throw new Error("Interação TikTok bloqueada pela conta");
  const quality = z.object({ duration_seconds: z.number().positive(), decode_verified: z.literal(true) }).parse(organic.quality);
  if (quality.duration_seconds > creator.max_video_post_duration_sec) throw new Error("Vídeo excede duração permitida no TikTok");
  const url = new URL(organic.portrait);
  const storage = new URL(storageOrigin);
  if (storage.protocol !== "https:" || url.origin !== storage.origin || url.search || url.hash || url.username || url.password
    || !new RegExp(`^/storage/v1/object/public/[^/]+/episodes/${episode.id}/render/final/[a-f0-9]{64}/episode_portrait[.]mp4$`).test(url.pathname)) {
    throw new Error("TikTok requer render imutável do Storage HTTPS configurado");
  }
  return { creatorUsername: creator.creator_username, videoUrl: url.href, body: {
    post_info: { title: choice.title, privacy_level: choice.privacy_level,
      disable_comment: !choice.allow_comment, disable_duet: !choice.allow_duet, disable_stitch: !choice.allow_stitch,
      brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true },
    source_info: { source: "PULL_FROM_URL" as const, video_url: url.href },
  } };
}
