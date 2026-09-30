import type { ScriptJson } from "../schemas/script-json.ts";

export function makeValidScript(): ScriptJson {
  const narrations = [
    "Uma mesa cheia de cabos parece um detalhe pequeno, mas pode atrapalhar quando você precisa trocar um aparelho ou descobrir qual fio pertence a cada carregador. Nesta pauta, mostramos um organizador de cabos e observamos seu formato, a posição em que ele ficaria na mesa e quais perguntas vale fazer antes de escolher qualquer acessório desse tipo. A imagem é ilustrativa e não representa um teste pessoal.",
    "Primeiro, repare no caminho dos fios entre a tomada e os dispositivos. Um organizador pode ajudar a reunir esses trajetos em um ponto visível, enquanto a posição dos conectores determina o espaço necessário para conectar e desconectar cada cabo. Compare o tamanho do acessório com a área disponível na mesa e confira se o método de fixação combina com a superfície. Também importa saber quantos cabos serão usados ao mesmo tempo. A escolha depende dessas medidas e das especificações do modelo consultado; a fotografia de contexto não comprova desempenho ou compatibilidade.",
    "Antes de decidir, confira as dimensões e o material informados pela fonte do produto. Pense no local da instalação e no acesso aos conectores depois da montagem. Se faltar essa informação, procure a documentação original. Qual parte da sua mesa mais precisa de organização hoje? Conte nos comentários para orientar uma próxima explicação.",
  ];
  const scene = (order: number, role: "hook" | "content" | "cta") => ({
    id: `scene-${order}`,
    order,
    role,
    duration_seconds: [30, 40, 25][order]!,
    narration_text: narrations[order]!,
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
      full_text: narrations.join(" "),
      language: "pt-BR",
      estimated_duration_seconds: 95,
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
