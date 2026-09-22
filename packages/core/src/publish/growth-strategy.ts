import { z } from "zod";
import type { Scene, ScriptJson } from "../schemas/script-json.ts";

const text = z.string().trim().min(1).max(500);
export const growthStrategySchema = z.object({
  enabled: z.literal(true),
  engagement_ctas: z.array(text).min(1).max(20),
  youtube_conversion_ctas: z.array(text).min(1).max(20),
  disclosure: text,
  organic_blocked_phrases: z.array(text).min(1).max(50),
  briefings: z.object({ tiktok: text, youtube: text }),
});
export type GrowthStrategy = z.infer<typeof growthStrategySchema>;

export const platformCtasSchema = z.object({
  youtube: z.object({ narration_text: text, commercial: z.boolean() }),
  tiktok: z.object({ narration_text: text, commercial: z.literal(false) }),
  organic_blocked_phrases: z.array(text).min(1).max(50),
});

// Additional audio/subtitle slot; visual assets remain shared with the CTA scene.
export function platformMediaScenes(script: ScriptJson): Scene[] {
  if (!script.platform_ctas) return script.scenes;
  const cta = [...script.scenes].sort((a, b) => a.order - b.order).at(-1)!;
  return [...script.scenes, {
    ...cta, id: `${cta.id}-tiktok`, order: script.scenes.length,
    narration_text: script.platform_ctas.tiktok.narration_text, highlight_words: [],
  }];
}

export function growthBriefing(config: GrowthStrategy): string {
  return `TikTok orgânico: ${config.briefings.tiktok} YouTube Shorts: ${config.briefings.youtube}`;
}

/** System-owned endings; no claims added by a CTA and no model-owned links. */
export function applyGrowthStrategy(raw: Record<string, any>, config: GrowthStrategy, youtubeLink: string | undefined, episodeId: string) {
  const index = parseInt(episodeId.replaceAll("-", "").slice(-6), 16) || 0;
  const engagement = config.engagement_ctas[index % config.engagement_ctas.length]!;
  const conversion = config.youtube_conversion_ctas[index % config.youtube_conversion_ctas.length]!;
  const commercial = Boolean(youtubeLink);
  const youtubeCta = commercial ? `${conversion} ${config.disclosure}` : engagement;
  const scenes = raw.scenes.map((scene: Scene) => scene.role === "cta"
    ? { ...scene, narration_text: youtubeCta, highlight_words: [] }
    : scene);
  return { ...raw, scenes,
    narration: { ...raw.narration, full_text: [...scenes].sort((a: Scene,b: Scene) => a.order-b.order).map((s: Scene) => s.narration_text).join(" ") },
    platform_ctas: {
      youtube: { narration_text: youtubeCta, commercial },
      tiktok: { narration_text: engagement, commercial: false },
      organic_blocked_phrases: config.organic_blocked_phrases,
    },
    disclosures: { contains_synthetic_media: true, commercial_content: commercial, commercial_disclosure_text: commercial ? config.disclosure : null },
  };
}
