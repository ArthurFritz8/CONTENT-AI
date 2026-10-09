import { z } from "zod";
import { platformCtasSchema } from "../publish/growth-strategy.ts";
import { storyContextSchema, storyVisualSchema } from "../stories/schema.ts";
import { animatedOutputSchema, animatedSceneSchema, ANIMATED_CHAPTER_SECONDS, ANIMATED_SHOT_SECONDS } from "../stories/animation-contract.ts";

// Constraints citados também no prompt do Gemini — fonte única (ADR-005).
export const SCENE_COUNT = { min: 3, max: 8 } as const;
export const SCENE_DURATION_SECONDS = { min: 5, max: 45 } as const;
// Target editorial (ADR-006): teto efetivo atual é 8×45s = 360s; 600 é à prova de futuro
export const TOTAL_DURATION_TARGET_SECONDS = { min: 60, max: 600 } as const;
export const DEFAULT_GAP_SECONDS = 0.5;
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_TAGS_TOTAL_MAX = 500;

const semverRegex = /^\d+\.\d+\.\d+$/;

// Espelha os CHECKs da tabela assets
export const assetRefSchema = z.object({
  url: z.string().url(),
  license: z.enum(["pexels", "generated", "youtube_audio_library", "own"]),
  source: z.enum(["gemini", "edge", "piper", "pexels", "youtube_audio", "manual", "affiliate", "system"]),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  // Template híbrido (ADR-005/008): hook abre, cta fecha, content no meio
  role: z.enum(["hook", "content", "cta"]),
  duration_seconds: z
    .number()
    .min(1)
    .max(SCENE_DURATION_SECONDS.max),
  narration_text: z.string().min(1),
  transition: z.enum(["cut", "fade", "zoom"]),
  ken_burns: z.enum(["in", "out", "pan_left", "pan_right", "static"]),
  // Preenchido no estado 'script'; diz ao generate-assets O QUE buscar/gerar
  visual: z.object({
    description: z.string().min(1),
    search_query: z.string().min(1),
  }),
  // palavras-chave da narração destacadas na legenda (ADR-010)
  highlight_words: z.array(z.string().min(1)).max(3).default([]),
  // true = usar o personagem/apresentador fixo nesta cena (ADR-030); decisão do próprio roteiro, opt-in e raro
  presenter: z.boolean().default(false),
  story_visual: storyVisualSchema.optional(),
  animation: animatedSceneSchema.optional(),
  // null até o estado 'assets' (contrato estagiado — ADR-005)
  asset_landscape: assetRefSchema.nullable(),
  asset_portrait: assetRefSchema.nullable(),
  subtitle_position: z.enum(["bottom_center", "bottom_left"]),
});

export const EDITORIAL_STYLES = [
  "hook_choque_ritmo_rapido",
  "storytelling_pessoal",
  "comparacao_lado_a_lado",
  "mito_vs_verdade",
  "unboxing_primeira_impressao",
  "explicativo_pausado",
] as const;

export const scriptJsonSchema = z
  .object({
    episode_id: z.string().uuid(),
    prompt_version: z.string().regex(semverRegex, "prompt_version deve ser semver (x.y.z)"),
    // Rótulo do estilo editorial escolhido pelo roteirista (ADR-033) — varia por vídeo, usado em analytics.
    editorial_style: z.string().min(1).max(80),
    platform_ctas: platformCtasSchema.optional(),
    fiction: z.object({ context: storyContextSchema, summary: z.string().min(30).max(1200), animation: animatedOutputSchema.optional() }).optional(),
    metadata: z.object({
      youtube: z.object({
        title: z.string().min(1).max(YOUTUBE_TITLE_MAX),
        description: z.string().min(1).max(5000),
        tags: z.array(z.string().min(1)).min(1).max(30),
        category: z.string().min(1),
      }),
      tiktok: z.object({
        title: z.string().min(1).max(100),
        description: z.string().min(1).max(2200),
        hashtags: z.array(z.string().min(1)).min(1).max(20),
      }),
    }),
    narration: z.object({
      full_text: z.string().min(1),
      language: z.literal("pt-BR"),
      estimated_duration_seconds: z.number().positive(),
    }),
    // Silêncio entre cenas no render (parâmetro de render, fora do hash editorial — ADR-006)
    gap_seconds: z.number().min(0).max(5).default(DEFAULT_GAP_SECONDS),
    // null até o estado 'assets'
    music: z
      .object({
        url: z.string().min(1),
        license: z.enum(["youtube_audio_library", "own"]),
        volume: z.number().min(0).max(1),
      })
      .nullable(),
    scenes: z.array(sceneSchema).min(SCENE_COUNT.min).max(SCENE_COUNT.max),
    // formato exige claims com evidência — mínimo 1 fonte
    sources: z
      .array(z.object({ claim: z.string().min(1), source_url: z.string().url() }))
      .max(20),
    disclosures: z.object({
      contains_synthetic_media: z.literal(true),
      commercial_content: z.boolean(),
      commercial_disclosure_text: z.string().min(1).nullable(),
    }),
  })
  .superRefine((script, ctx) => {
    const animation = script.fiction?.animation;
    if (animation) {
      const cast = new Set(script.fiction!.context.bible.cast.map(c => c.id));
      if (script.scenes.length < 5 || script.gap_seconds !== 0 || script.music !== null || script.platform_ctas)
        ctx.addIssue({ code: "custom", path: ["fiction", "animation"], message: "Capítulo animado exige 5–8 tomadas, sem pausa, trilha ou CTA alternativo" });
      for (const s of script.scenes) {
        if (!s.animation || s.animation.shot_id !== s.id || !cast.has(s.animation.character_id) ||
          s.story_visual?.speaker_id !== s.animation.character_id || !s.story_visual.on_stage.includes(s.animation.character_id) ||
          Math.abs(s.duration_seconds - ANIMATED_SHOT_SECONDS) > 1e-9 || s.transition !== "cut" || s.ken_burns !== "static" ||
          s.asset_landscape !== null)
          ctx.addIssue({ code: "custom", path: ["scenes", s.order], message: "Tomada animada precisa de fala visível, identidade e duração vinculadas, sem reenquadramento horizontal" });
      }
    } else if (script.scenes.some(s => s.animation || s.duration_seconds < SCENE_DURATION_SECONDS.min)) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "Cenas curtas são exclusivas do contrato de animação" });
    }
    if (!script.fiction && script.sources.length === 0)
      ctx.addIssue({ code: "custom", path: ["sources"], message: "Vídeo factual exige fontes" });
    if (script.fiction && (script.sources.length > 0 || script.disclosures.commercial_content || script.scenes.some(s => !s.story_visual)))
      ctx.addIssue({ code: "custom", path: ["fiction"], message: "Ficção exige cenas do elenco, sem fontes factuais ou conteúdo comercial" });
    if (new Set(script.scenes.map(scene => scene.id)).size !== script.scenes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenes"], message: "scenes[].id deve ser único" });
    }
    const orders = [...script.scenes].map((s) => s.order).sort((a, b) => a - b);
    if (!orders.every((o, i) => o === i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "scenes[].order deve ser contíguo de 0 a n-1, sem duplicatas",
      });
    }
    const byOrder = [...script.scenes].sort((a, b) => a.order - b.order);
    if (byOrder[0]?.role !== "hook") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "A primeira cena (order 0) deve ter role='hook'",
      });
    }
    if (byOrder[byOrder.length - 1]?.role !== "cta") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "A última cena deve ter role='cta'",
      });
    }
    if (byOrder.slice(1, -1).some((s) => s.role !== "content")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "Cenas intermediárias devem ter role='content'",
      });
    }
    if (script.disclosures.commercial_content && !script.disclosures.commercial_disclosure_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disclosures", "commercial_disclosure_text"],
        message: "commercial_content=true exige commercial_disclosure_text",
      });
    }
    const tagsTotal = script.metadata.youtube.tags.map(tag => tag.includes(" ") ? `"${tag}"` : tag).join(",").length;
    if (tagsTotal > YOUTUBE_TAGS_TOTAL_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metadata", "youtube", "tags"],
        message: `Tags somam ${tagsTotal} chars — limite da API do YouTube é ${YOUTUBE_TAGS_TOTAL_MAX}`,
      });
    }
    // Regra 9 (ADR-006): duration_seconds é TARGET para o Gemini, não constraint de render
    const totalTarget = script.scenes.reduce((sum, s) => sum + s.duration_seconds, 0);
    if (
      totalTarget < (animation ? ANIMATED_CHAPTER_SECONDS.min : TOTAL_DURATION_TARGET_SECONDS.min) - 1e-9 ||
      totalTarget > (animation ? ANIMATED_CHAPTER_SECONDS.max : TOTAL_DURATION_TARGET_SECONDS.max) + 1e-9
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message:
          `Soma dos targets de duração (${totalTarget}s) fora do intervalo ` +
          `${TOTAL_DURATION_TARGET_SECONDS.min}-${TOTAL_DURATION_TARGET_SECONDS.max}s`,
      });
    }
  });

export type ScriptJson = z.infer<typeof scriptJsonSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type AssetRef = z.infer<typeof assetRefSchema>;

/** O renderer só aceita scripts com todos os assets resolvidos (estado 'assets' completo). */
export function isRenderReady(script: ScriptJson): boolean {
  if (script.fiction?.animation) return script.scenes.every(s => s.asset_portrait !== null && s.animation !== undefined);
  return script.scenes.every((s) => s.asset_landscape !== null && s.asset_portrait !== null);
}
