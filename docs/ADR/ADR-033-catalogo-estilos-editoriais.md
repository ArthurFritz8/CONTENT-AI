# ADR-033 — Catálogo de estilos editoriais para variedade real entre vídeos

## Objetivo

Responder ao pedido do usuário por vídeos "dinâmicos, variados e de alto impacto visual" dentro da arquitetura zero-orçamento atual — sem inventar capacidades de render que não existem (não há geração de vídeo real, avatar falando ou lip-sync; o pipeline produz imagem estática + Ken Burns + TTS + legendas).

## Contexto

O prompt de roteiro (ADR-005/008) já expõe todos os parâmetros necessários para variar a experiência do vídeo — `transition` (`cut/fade/zoom`), `ken_burns` (`in/out/pan_left/pan_right/static`), `duration_seconds` por cena e, desde o ADR-030/031, `presenter`. O que faltava era o roteirista (Gemini) ser instruído a **combinar esses parâmetros de forma consistente com uma intenção criativa**, e a **variar essa intenção entre vídeos**, em vez de gerar sempre a mesma cadência.

## Decisão

- Novo campo `editorial_style: string` no `ScriptJson` (obrigatório, curto) — rótulo do estilo escolhido para o vídeo, usado em auditoria/analytics (`job_events.metadata` e `episodes.metadata`).
- `buildScriptPrompt` ganha um catálogo de 6 estilos nomeados, cada um com uma correspondência EXPLÍCITA para os campos técnicos já existentes:
  - `hook_choque_ritmo_rapido`, `storytelling_pessoal`, `comparacao_lado_a_lado`, `mito_vs_verdade`, `unboxing_primeira_impressao`, `explicativo_pausado`.
- O prompt permite que o modelo proponha um estilo novo e mais inovador, desde que descreva a intenção e respeite as mesmas regras técnicas do contrato — atende ao pedido do usuário por "uma ideia melhor" sem abrir mão de validação estrutural (Zod continua validando roles/order/duration independentemente do estilo).
- O uso do personagem fixo (ADR-031) passa a ser sugerido por afinidade de estilo (ex.: `storytelling_pessoal`/`unboxing_primeira_impressao` combinam mais com presenter do que `comparacao_lado_a_lado`), mantendo o mesmo cap e opt-in já existentes.

## Impacto e limites

- Não há geração de vídeo real nem trilha sonora dinâmica por estilo nesta entrega — a variedade acontece dentro do que o renderer (Ken Burns + FFmpeg) já sabe fazer. Ampliar isso (ex.: música por estilo, mais transições) é evolução futura, não bloqueante.
- `editorial_style` é texto livre (não enum rígido no schema) para não sufocar a criatividade pedida, mas fortemente ancorado no catálogo do prompt — o QA de roteiro (`script-quality.ts`) não valida o estilo em si, apenas os invariantes estruturais já existentes.
- Nenhuma mudança na cadeia de fallback de imagens, TTS ou render — só no texto do prompt e no contrato.

## Prevenção

- Testes cobrem: `scriptJsonSchema` exige `editorial_style` (schema); `buildScriptPrompt` inclui o catálogo completo e referencia o estilo corretamente.
- Qualquer novo parâmetro técnico de estilo (ex.: nova opção de `ken_burns`) deve ser adicionado ao contrato primeiro (fonte única de verdade) e só depois referenciado no catálogo do prompt — nunca o inverso.
