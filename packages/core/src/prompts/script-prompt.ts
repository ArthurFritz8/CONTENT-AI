// Fase 2 (ADR-008): Gemini Flash SEM grounding + responseSchema → script_json.
// Constraints importados do contrato — uma fonte de verdade (ADR-005).

import {
  EDITORIAL_STYLES,
  SCENE_COUNT,
  SCENE_DURATION_SECONDS,
  TOTAL_DURATION_TARGET_SECONDS,
} from "../schemas/script-json.ts";
import type { ResearchData } from "../schemas/research.ts";

export const SCRIPT_PROMPT_NAME = "script_prompt";

export interface ScriptPromptInput {
  briefing: string;
  researchData: ResearchData;
  isCommercial: boolean;
  platformGrowth?: boolean;
  commercialPlatforms?: Array<"youtube" | "tiktok">;
  // ADR-030: quando definido, o personagem fixo pode ser usado em cenas específicas
  spokesmodel?: { characterDescription: string; maxScenesPerEpisode: number };
}

// ADR-033: catálogo de estilos editoriais — cada um mapeado para parâmetros
// técnicos que JÁ existem no contrato (transition/ken_burns/duration/presenter),
// sem exigir nenhuma capacidade nova de render. O objetivo é variedade real
// entre vídeos, não um template único repetido sempre.
const EDITORIAL_STYLE_CATALOG = `
- hook_choque_ritmo_rapido: abertura com afirmação/pergunta impactante nos primeiros 2s. Cenas mais curtas (perto do mínimo de duração), transitions predominantemente "cut" e "zoom", ken_burns "in"/"pan_left"/"pan_right" alternados a cada cena — sensação de ritmo acelerado. Narração enérgica, frases curtas.
- storytelling_pessoal: abre com uma situação cotidiana em primeira pessoa ("eu tinha esse problema..."). Cenas um pouco mais longas, transitions "fade" predominantes, ken_burns mais suave ("in"/"out" lentos). Narração em tom de conversa, mais pausada. Combina bem com presenter=true no hook ou no cta, se disponível.
- comparacao_lado_a_lado: estrutura em cenas de "content" que contrastam antes/depois ou "produto X vs. método antigo". Prefira transition "cut" entre pares de comparação e ken_burns "pan_left"/"pan_right" para sugerir contraste visual. Narração analítica, objetiva.
- mito_vs_verdade: cada cena de "content" apresenta uma crença comum e a desmente com um fato pesquisado (sempre com claim/source_url real). Transition "cut" seco entre mito e verdade. Narração com leve tom de "revelação", sem sensacionalismo.
- unboxing_primeira_impressao: hook mostra o produto sendo visto pela primeira vez; cenas de content simulam a exploração/uso passo a passo. ken_burns "in" progressivo (aproximando do produto), transitions "zoom" nos detalhes. Narração curiosa, descritiva.
- explicativo_pausado: ritmo mais calmo, cenas próximas do máximo de duração, transitions "fade", ken_burns "static"/"out" suaves. Narração didática, passo a passo, ideal quando o produto exige mais explicação técnica.

Você pode também propor uma variação própria e mais inovadora, desde que descreva um estilo coerente e mantenha as mesmas regras técnicas do contrato (roles, transitions, ken_burns, duração).`;

export function buildScriptPrompt(input: ScriptPromptInput): string {
  const claims = input.researchData
    .map((c, i) => `${i + 1}. ${c.claim} (fonte: ${c.source_url}, confiança: ${c.confidence})`)
    .join("\n");
  const commercialPlatforms = input.commercialPlatforms?.length
    ? input.commercialPlatforms.join(", ")
    : "nenhuma plataforma com link validado";

  return `Você é um roteirista de vídeos curtos de produtos para um canal de recomendações honestas de gadgets e soluções úteis. O objetivo é ajudar a pessoa a decidir se o produto resolve o problema dela; a conversão vem da demonstração e da confiança, não de promessas exageradas.

BRIEFING:
${input.briefing}

${input.platformGrowth ? "VERSÕES POR PLATAFORMA: o corpo do vídeo (hook/content), as imagens e a descrição TikTok devem ser estritamente editoriais: sem venda, link, comissão ou convite de compra. Demonstre somente o que as evidências e imagens autorizadas permitem; nunca finja experiência pessoal ou teste. O sistema substituirá o encerramento por dois CTAs: TikTok engajamento; YouTube link no perfil e disclosure somente após validação do link. Não coloque textos comerciais no visual compartilhado. Formato curto: mire a soma mínima de duração do contrato; não prometa lista de vários produtos quando a pesquisa só cobre um." : ""}

FATOS PESQUISADOS (use APENAS estes — não invente fatos nem fontes):
${claims}

ESTILO EDITORIAL (ADR-033): escolha o estilo que melhor se encaixa neste produto e briefing — e varie em relação aos vídeos anteriores deste canal; não repita sempre a mesma fórmula. Preencha editorial_style com o nome do estilo escolhido (use um dos rótulos abaixo, ex.: "${EDITORIAL_STYLES[0]}", ou descreva um novo em poucas palavras se for genuinamente melhor).
${EDITORIAL_STYLE_CATALOG}

O estilo escolhido deve se refletir nas cenas: ajuste transition, ken_burns e duration_seconds de cada cena para combinar com o estilo (ex.: estilo rápido = cenas mais curtas e cuts; estilo pausado = cenas mais longas e fades). Isso não é decorativo — é a diferença real entre os vídeos.

ESTRUTURA OBRIGATÓRIA DO ROTEIRO ORIENTADA AO PRODUTO:
- ${SCENE_COUNT.min} a ${SCENE_COUNT.max} cenas, cada uma com ${SCENE_DURATION_SECONDS.min} a ${SCENE_DURATION_SECONDS.max} segundos.
- Soma dos duration_seconds entre ${TOTAL_DURATION_TARGET_SECONDS.min} e ${TOTAL_DURATION_TARGET_SECONDS.max} segundos.
- Primeira cena: role="hook" (mostre o problema cotidiano e identifique o produto; sem clickbait mentiroso).
- Cenas do meio: role="content" (explique como funciona, demonstre o uso e inclua ao menos uma limitação ou contexto de compatibilidade quando houver evidência).
- Última cena: role="cta"${input.isCommercial ? " com disclosure comercial e convite claro para conferir o link do produto" : " com resumo para quem o produto pode fazer sentido"}.
- scenes[].order começa em 0 e é contíguo, sem pulos.
- Em sources, copie literalmente os pares claim/source_url dos FATOS PESQUISADOS usados. Não parafraseie o campo claim nem troque a URL. A narração pode explicar esses fatos, sem acrescentar promessas.
- narration.full_text deve ser a concatenação exata de narration_text de todas as cenas em ordem, separadas por um espaço.
- Não use promessas médicas, de retorno financeiro, cura, garantia de resultado, desconto, menor preço, estoque, entrega ou superlativos absolutos ("o melhor do mundo", "único no mercado") sem evidência explícita. Nunca invente preço, promoção, cupom, nota, prazo ou especificação.
- Não diga que uma imagem stock é o produto real. Use imagens do produto autorizado quando disponíveis; caso contrário, descreva a cena como ilustração/contexto.
- visual.description: descrição rica para gerar imagem (estilo, enquadramento, objeto), coerente com o estilo editorial escolhido.
- visual.search_query: consulta curta em inglês para banco de imagens (fallback).
- highlight_words: 1 a 2 palavras-chave POR CENA, copiadas exatamente como aparecem em narration_text, para destaque visual na legenda.
- narration_text: tom conversacional, português do Brasil, frases curtas para narração, com o tom do estilo escolhido.
${input.isCommercial ? `- disclosures.commercial_content=true e commercial_disclosure_text preenchido. Copie esse disclosure literalmente na narração do CTA e ${input.platformGrowth ? "somente na descrição YouTube; TikTok não pode conter disclosure de afiliado nem link comercial" : "nas descrições YouTube e TikTok"}. Plataformas com link validado: ${commercialPlatforms}. O sistema acrescentará em cada descrição somente o link pertencente àquela plataforma; não invente, copie ou altere URLs.` : "- disclosures.commercial_content=false e commercial_disclosure_text=null."}
${input.spokesmodel ? `- Personagem fixo disponível (opcional, ADR-030): "${input.spokesmodel.characterDescription}". Você pode marcar scenes[].presenter=true em no máximo ${input.spokesmodel.maxScenesPerEpisode} cena(s) deste roteiro, apenas quando isso agregar de verdade e combinar com o estilo escolhido (ex.: storytelling_pessoal e unboxing_primeira_impressao costumam se beneficiar mais de um presenter do que comparacao_lado_a_lado) — varie: nem todo vídeo precisa usar, e nunca use em mais cenas do que o limite. Nas demais cenas, presenter=false (padrão).` : "- Não há personagem fixo disponível agora: todas as scenes[].presenter devem ser false."}

Retorne APENAS o JSON no formato especificado.`;
}

export function buildRepairPrompt(invalidJson: string, errors: string[]): string {
  return `O JSON abaixo falhou na validação. Corrija SOMENTE os erros listados, preservando todo o resto do conteúdo. Retorne APENAS o JSON corrigido.

ERROS DE VALIDAÇÃO:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

JSON INVÁLIDO:
${invalidJson}`;
}
