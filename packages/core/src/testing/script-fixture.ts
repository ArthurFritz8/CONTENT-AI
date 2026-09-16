import type { ScriptJson } from "../schemas/script-json.ts";

export function makeValidScript(): ScriptJson {
  const scene = (order: number, role: "hook" | "content" | "cta") => ({
    id: `scene-${order}`,
    order,
    role,
    duration_seconds: 20,
    narration_text: `Narração da cena ${order}`,
    transition: "fade" as const,
    ken_burns: "in" as const,
    visual: { description: `Imagem da cena ${order}`, search_query: `query ${order}` },
    highlight_words: [],
    presenter: false,
    asset_landscape: null,
    asset_portrait: null,
    subtitle_position: "bottom_center" as const,
  });
  return {
    episode_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    prompt_version: "1.0.0",
    editorial_style: "explicativo_pausado",
    metadata: {
      youtube: {
        title: "Título de teste",
        description: "Descrição de teste",
        tags: ["teste", "video"],
        category: "Education",
      },
      tiktok: {
        title: "Título TikTok",
        description: "Descrição TikTok",
        hashtags: ["#teste"],
      },
    },
    narration: {
      full_text: "Narração da cena 0 Narração da cena 1 Narração da cena 2",
      language: "pt-BR",
      estimated_duration_seconds: 60,
    },
    gap_seconds: 0.5,
    music: null,
    scenes: [scene(0, "hook"), scene(1, "content"), scene(2, "cta")],
    sources: [{ claim: "Afirmação X", source_url: "https://example.com/fonte" }],
    disclosures: {
      contains_synthetic_media: true,
      commercial_content: false,
      commercial_disclosure_text: null,
    },
  };
}
