// Fase 2 (ADR-008): Gemini Flash SEM grounding + responseSchema → script_json.
// Constraints importados do contrato — uma fonte de verdade (ADR-005).

import {
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
}

export function buildScriptPrompt(input: ScriptPromptInput): string {
  const claims = input.researchData
    .map((c, i) => `${i + 1}. ${c.claim} (fonte: ${c.source_url}, confiança: ${c.confidence})`)
    .join("\n");

  return `Você é um roteirista de vídeos curtos de produtos para um canal de recomendações honestas de gadgets e soluções úteis. O objetivo é ajudar a pessoa a decidir se o produto resolve o problema dela; a conversão vem da demonstração e da confiança, não de promessas exageradas.

BRIEFING:
${input.briefing}

FATOS PESQUISADOS (use APENAS estes — não invente fatos nem fontes):
${claims}

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
- visual.description: descrição rica para gerar imagem (estilo, enquadramento, objeto).
- visual.search_query: consulta curta em inglês para banco de imagens (fallback).
- highlight_words: 1 a 2 palavras-chave POR CENA, copiadas exatamente como aparecem em narration_text, para destaque visual na legenda.
- narration_text: tom conversacional, português do Brasil, frases curtas para narração.
${input.isCommercial ? '- disclosures.commercial_content=true e commercial_disclosure_text preenchido (ex: "Este vídeo contém link de afiliado. Se você comprar pelo link, podemos receber uma comissão."). Copie esse disclosure literalmente na narração do CTA e nas descrições YouTube e TikTok. O sistema acrescentará o link exato do produto às descrições; não invente nem altere URLs.' : "- disclosures.commercial_content=false e commercial_disclosure_text=null."}

Retorne APENAS o JSON no formato especificado.`;
}

export function buildRepairPrompt(invalidJson: string, errors: string[]): string {
  return `O JSON abaixo falhou na validação. Corrija SOMENTE os erros listados, preservando todo o resto do conteúdo. Retorne APENAS o JSON corrigido.

ERROS DE VALIDAÇÃO:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

JSON INVÁLIDO:
${invalidJson}`;
}
