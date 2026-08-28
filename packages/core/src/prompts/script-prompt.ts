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

  return `Você é um roteirista de vídeos curtos estilo "você não vai acreditar que isso existe" para um canal de gadgets e produtos inovadores.

BRIEFING:
${input.briefing}

FATOS PESQUISADOS (use APENAS estes — não invente fatos nem fontes):
${claims}

ESTRUTURA OBRIGATÓRIA DO ROTEIRO:
- ${SCENE_COUNT.min} a ${SCENE_COUNT.max} cenas, cada uma com ${SCENE_DURATION_SECONDS.min} a ${SCENE_DURATION_SECONDS.max} segundos.
- Soma dos duration_seconds entre ${TOTAL_DURATION_TARGET_SECONDS.min} e ${TOTAL_DURATION_TARGET_SECONDS.max} segundos.
- Primeira cena: role="hook" (gancho de curiosidade forte, sem clickbait mentiroso).
- Cenas do meio: role="content" (demonstração e comparação usando os fatos pesquisados).
- Última cena: role="cta"${input.isCommercial ? " incluindo o disclosure comercial na narração" : ""}.
- scenes[].order começa em 0 e é contíguo, sem pulos.
- Todo claim usado na narração deve aparecer em sources com a source_url original.
- visual.description: descrição rica para gerar imagem (estilo, enquadramento, objeto).
- visual.search_query: consulta curta em inglês para banco de imagens (fallback).
- highlight_words: 1 a 2 palavras-chave POR CENA, copiadas exatamente como aparecem em narration_text, para destaque visual na legenda.
- narration_text: tom conversacional, português do Brasil, frases curtas para narração.
${input.isCommercial ? '- disclosures.commercial_content=true e commercial_disclosure_text preenchido (ex: "Este vídeo contém link de afiliado.").' : "- disclosures.commercial_content=false e commercial_disclosure_text=null."}

Retorne APENAS o JSON no formato especificado.`;
}

export function buildRepairPrompt(invalidJson: string, errors: string[]): string {
  return `O JSON abaixo falhou na validação. Corrija SOMENTE os erros listados, preservando todo o resto do conteúdo. Retorne APENAS o JSON corrigido.

ERROS DE VALIDAÇÃO:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

JSON INVÁLIDO:
${invalidJson}`;
}
