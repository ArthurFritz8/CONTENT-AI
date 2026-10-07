import { scriptJsonSchema, type ScriptJson } from "../schemas/script-json.ts";
import { canonicalStringify } from "../validators/hash-utils.ts";
import { storyContextSchema, storyDraftSchema, type StoryContext } from "./schema.ts";
import { validateStoryDirection } from "./direction.ts";

export function fictionPlanMatches(context: unknown, evidence: unknown): boolean {
  const parsed = storyContextSchema.safeParse(context);
  const plan = evidence as { type?: string; context?: unknown } | null;
  return parsed.success && plan?.type === "fiction_plan" &&
    canonicalStringify(parsed.data) === canonicalStringify(plan.context);
}
export function buildStoryScript(raw: unknown, context: StoryContext, episodeId: string, requireDirection = false): ScriptJson {
  const draft = storyDraftSchema.parse(raw);
  validateStoryDirection(draft.scenes, requireDirection);
  const castIds = new Set(context.bible.cast.map(c => c.id));
  for (const scene of draft.scenes) {
    if ((scene.visual.speaker_id !== "narrator" && !castIds.has(scene.visual.speaker_id)) ||
      scene.visual.on_stage.some(id => !castIds.has(id)) ||
      (scene.visual.speaker_id !== "narrator" && !scene.visual.on_stage.includes(scene.visual.speaker_id)) ||
      new Set(scene.visual.on_stage).size !== scene.visual.on_stage.length)
      throw new Error("Cena cita personagem ausente do elenco ou repetido");
  }
  const scenes: Array<Record<string, unknown>> = draft.scenes.map((s, order) => ({
    id: `story_${order}`, order, role: order === 0 ? "hook" : "content",
    duration_seconds: 12, narration_text: s.narration_text,
    transition: "cut", ken_burns: order % 2 ? "out" : "in",
    visual: { description: s.visual.direction
      ? `${s.visual.direction.framing}: ${s.visual.direction.action} Emoção: ${s.visual.direction.emotion_change}. Continuidade: ${s.visual.direction.continuity}`
      : `Arte original de ${context.bible.title}, cena ${order + 1}.`, search_query: "original illustration" },
    story_visual: s.visual, highlight_words: [], presenter: false,
    asset_landscape: null, asset_portrait: null, subtitle_position: "bottom_center",
  }));
  const cta = context.chapter_number < context.bible.chapters.length
    ? "Qual decisão você tomaria? Comente e acompanhe o próximo capítulo desta história original."
    : "Qual personagem te surpreendeu? Comente o que achou do final e acompanhe outras histórias originais.";
  const last = draft.scenes[draft.scenes.length - 1]!;
  scenes.push({ ...scenes[scenes.length - 1]!, id: "story_cta", order: scenes.length,
    role: "cta", duration_seconds: 6, narration_text: cta,
    story_visual: { ...last.visual, speaker_id: "narrator" } });
  const description = `Ficção original criada com apoio de IA. ${context.bible.title} — capítulo ${context.chapter_number}/${context.bible.chapters.length}. ${draft.summary}`;
  return scriptJsonSchema.parse({
    episode_id: episodeId, prompt_version: requireDirection ? "1.1.0" : "1.0.0", editorial_style: "storytelling_pessoal",
    fiction: { context, summary: draft.summary },
    metadata: {
      youtube: { title: draft.title, description, tags: ["história original", "ficção", "novela"], category: "24" },
      tiktok: { title: draft.title, description, hashtags: ["#HistoriaOriginal", "#Ficcao", "#Novela"] },
    },
    narration: { full_text: scenes.map(s => s.narration_text).join(" "), language: "pt-BR",
      estimated_duration_seconds: scenes.reduce((sum, s) => sum + Number(s.duration_seconds), 0) },
    gap_seconds: 0.25, music: null, scenes, sources: [],
    platform_ctas: { youtube: { narration_text: cta, commercial: false },
      tiktok: { narration_text: cta, commercial: false }, organic_blocked_phrases: ["link na bio", "compre agora"] },
    disclosures: { contains_synthetic_media: true, commercial_content: false, commercial_disclosure_text: null },
  });
}
