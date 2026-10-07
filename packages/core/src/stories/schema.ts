import { z } from "zod";
import { storyDirectionSchema } from "./direction.ts";

export const storyKinds = { original: "Histórias originais", fruits: "Novela de frutas" } as const;
export const storyRequestSchema = z.object({
  kind: z.enum(["original", "fruits"]),
  genre: z.enum(["comedy", "mystery", "drama", "adventure"]),
  premise: z.string().trim().min(30).max(1000),
  chapters: z.number().int().min(1).max(6),
});
export const characterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
  name: z.string().trim().min(2).max(40),
  appearance: z.enum(["human", "robot", "apple", "orange", "pear", "grape", "strawberry"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  personality: z.string().trim().min(10).max(300),
  voice: z.enum(["male", "female"]),
});
export const seriesBibleSchema = z.object({
  title: z.string().trim().min(5).max(100),
  kind: z.enum(["original", "fruits"]),
  premise: z.string().trim().min(30).max(1200),
  genre: z.enum(["comedy", "mystery", "drama", "adventure"]),
  cast: z.array(characterSchema).min(2).max(3),
  chapters: z.array(z.object({
    title: z.string().trim().min(5).max(100),
    arc: z.string().trim().min(30).max(700),
  })).min(1).max(6),
}).superRefine((v, ctx) => {
  if (new Set(v.cast.map(c => c.id)).size !== v.cast.length)
    ctx.addIssue({ code: "custom", path: ["cast"], message: "Personagens devem ter IDs únicos" });
  if (v.kind === "fruits" && v.cast.some(c => ["human", "robot"].includes(c.appearance)))
    ctx.addIssue({ code: "custom", path: ["cast"], message: "Novela de frutas exige personagens-fruta" });
});
export const storyContextSchema = z.object({
  series_id: z.string().uuid(), bible: seriesBibleSchema,
  chapter_number: z.number().int().min(1).max(6),
  previous_summaries: z.array(z.string().min(30).max(1200)).max(5),
}).superRefine((v, ctx) => {
  if (v.chapter_number > v.bible.chapters.length || v.previous_summaries.length !== v.chapter_number - 1)
    ctx.addIssue({ code: "custom", message: "Capítulo e continuidade incompatíveis" });
});
export const storyVisualSchema = z.object({
  speaker_id: z.string().regex(/^(narrator|[a-z][a-z0-9_]{0,23})$/),
  on_stage: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,23}$/)).min(1).max(3),
  setting: z.enum(["home", "office", "garden", "street"]),
  mood: z.enum(["neutral", "happy", "sad", "angry", "surprised"]),
  prop: z.enum(["none", "key", "letter", "box", "phone", "book"]).optional(),
  direction: storyDirectionSchema.optional(),
});
export const storyDraftSchema = z.object({
  title: z.string().trim().min(5).max(100), summary: z.string().trim().min(30).max(1200),
  scenes: z.array(z.object({
    narration_text: z.string().trim().min(30).max(700), visual: storyVisualSchema,
  })).min(5).max(7),
});
export type SeriesBible = z.infer<typeof seriesBibleSchema>;
export type StoryContext = z.infer<typeof storyContextSchema>;
export type StoryVisual = z.infer<typeof storyVisualSchema>;
export type StoryDraft = z.infer<typeof storyDraftSchema>;
export function storyVoice(context: StoryContext, speaker: string): string {
  return context.bible.cast.find(c => c.id === speaker)?.voice === "female"
    ? "pt-BR-FranciscaNeural" : "pt-BR-AntonioNeural";
}
