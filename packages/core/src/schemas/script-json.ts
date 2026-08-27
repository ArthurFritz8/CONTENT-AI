import { z } from "zod";

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
  source: z.enum(["gemini", "pexels", "youtube_audio", "manual"]),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  duration_seconds: z
    .number()
    .min(SCENE_DURATION_SECONDS.min)
    .max(SCENE_DURATION_SECONDS.max),
  narration_text: z.string().min(1),
  transition: z.enum(["cut", "fade", "zoom"]),
  ken_burns: z.enum(["in", "out", "pan_left", "pan_right", "static"]),
  // Preenchido no estado 'script'; diz ao generate-assets O QUE buscar/gerar
  visual: z.object({
    description: z.string().min(1),
    search_query: z.string().min(1),
  }),
  // null até o estado 'assets' (contrato estagiado — ADR-005)
  asset_landscape: assetRefSchema.nullable(),
  asset_portrait: assetRefSchema.nullable(),
  subtitle_position: z.enum(["bottom_center", "bottom_left"]),
});

export const scriptJsonSchema = z
  .object({
    episode_id: z.string().uuid(),
    prompt_version: z.string().regex(semverRegex, "prompt_version deve ser semver (x.y.z)"),
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
      .min(1),
    disclosures: z.object({
      contains_synthetic_media: z.literal(true),
      commercial_content: z.boolean(),
      commercial_disclosure_text: z.string().min(1).nullable(),
    }),
  })
  .superRefine((script, ctx) => {
    const orders = [...script.scenes].map((s) => s.order).sort((a, b) => a - b);
    if (!orders.every((o, i) => o === i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes"],
        message: "scenes[].order deve ser contíguo de 0 a n-1, sem duplicatas",
      });
    }
    if (script.disclosures.commercial_content && !script.disclosures.commercial_disclosure_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disclosures", "commercial_disclosure_text"],
        message: "commercial_content=true exige commercial_disclosure_text",
      });
    }
    const tagsTotal = script.metadata.youtube.tags.join(",").length;
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
      totalTarget < TOTAL_DURATION_TARGET_SECONDS.min ||
      totalTarget > TOTAL_DURATION_TARGET_SECONDS.max
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
  return script.scenes.every((s) => s.asset_landscape !== null && s.asset_portrait !== null);
}
