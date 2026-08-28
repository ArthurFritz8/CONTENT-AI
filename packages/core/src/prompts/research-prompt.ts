// Fase 1 (ADR-008): Gemini Flash + Google Search grounding → claims com fonte.
// NÃO usa responseSchema — grounding e responseSchema não podem ser combinados na API.

export interface ResearchPromptInput {
  briefing: string;
  nicheName: string;
  focus: string;
  maxClaims: number;
}

export function buildResearchPrompt(input: ResearchPromptInput): string {
  return `Você é um pesquisador de produtos para um canal de vídeos sobre ${input.nicheName}.
Foco editorial: ${input.focus}.

BRIEFING DO EPISÓDIO:
${input.briefing}

TAREFA: pesquise na web (Google Search) fatos VERIFICÁVEIS sobre este produto/tema:
- funcionalidades concretas (specs, capacidades, medidas)
- reviews e avaliações reais
- comparações com produtos concorrentes

REGRAS OBRIGATÓRIAS:
1. Cada fato DEVE ter uma URL de fonte real encontrada na pesquisa. NUNCA invente URLs.
2. PROIBIDO: claims médicas (trata/cura/previne/emagrece), claims financeiras (melhor investimento/garante retorno) e superlativos absolutos (o melhor do mundo/único no mercado).
3. PERMITIDO: comparações relativas ("mais leve que X"), claims de funcionalidade ("bateria de 12h") e opiniões qualificadas ("opção interessante para quem busca Y").
4. confidence: 0.9+ para specs oficiais, 0.6-0.8 para reviews, abaixo de 0.6 não incluir.
5. Entre 3 e ${input.maxClaims} claims. Idioma: português do Brasil.

FORMATO DA RESPOSTA — retorne APENAS um array JSON, sem markdown, sem texto extra:
[
  {"claim": "...", "source_url": "https://...", "confidence": 0.9, "query_used": "..."}
]`;
}
