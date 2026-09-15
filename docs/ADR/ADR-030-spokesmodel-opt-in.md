# ADR-030 — Personagem/apresentador fixo (spokesmodel) opt-in

Status: **substituído pelo ADR-031**. O usuário, ao ver o custo real envolvido (faturamento Gemini para gerar imagem), decidiu não gastar nada; a implementação de geração via Nano Banana descrita abaixo foi revertida antes de qualquer deploy e nunca chegou a rodar em produção. Mantido como registro histórico do debate e das travas técnicas descobertas (ainda válidas).

## Objetivo

Permitir que o roteiro use, em cenas específicas e raras, um personagem de IA fixo e consistente entre todos os episódios fazendo a demonstração/propaganda do produto — sem reabrir o veto do ADR-015 à geração de imagem genérica.

## Contexto

O usuário pediu um "modelo de IA padrão para todos os vídeos" e, quando questionado, aceitou explicitamente a alternativa mais barata: imagem estática consistente (sem lip-sync/vídeo falado, que exigiria API paga de terceiros e quebraria o pilar zero-orçamento).

Investigação prévia revelou duas travas deliberadas e redundantes contra geração de imagem paga (ADR-015):
1. `budget-guard.ts`: `getGeminiBudgetRemaining` retorna `0` hardcoded para `callType==="image"`.
2. `reserve_gemini_call` (SQL): `if p_kind='image' then return false; end if;` hardcoded.
3. `generate-assets/handler.ts` força `imageGenerationEnabled: false` na chamada do planner, ignorando até a flag de config.

Teste real contra a API confirmou: a chave `GEMINI_API_KEY` atual está no free tier (`limit: 0` para `gemini-2.5-flash-preview-image`) — sem faturamento ativo, a função geraria erro 429 sempre. Nenhuma chamada foi cobrada nesse teste.

## Decisão

**Não tocar em nenhuma das três travas do caminho de imagem genérico.** Em vez disso, criar um caminho completamente separado, opt-in e com custo real rastreado:

- Novo `GeminiCallType = "spokesmodel"` no budget guard, com limite próprio (`gemini_spokesmodel_requests_per_day_max`, default 20/dia — escolha do operador) e **sem** o `return 0`/`return false` hardcoded do tipo `image`.
- `recordGeminiCall` passa a registrar `cost_estimate` real (antes sempre `0`, presumindo free tier) para chamadas `spokesmodel`, lido de `system_config.budget.gemini_spokesmodel_cost_usd_estimate` (default US$0,04/imagem — estimativa, ajustar conforme `ai.google.dev/pricing`).
- `system_config.spokesmodel` novo, com `enabled=false` por padrão — precisa ativação explícita do operador **depois** de confirmar faturamento no Google AI Studio. Código existir não implica cobrança acontecer.
- `scenes[].presenter: boolean` (default `false`) no contrato `ScriptJson`. O próprio roteirista (Gemini, fase de script) decide, cena a cena, se o personagem aparece — respeitando o pedido do usuário de "variar e usar em ocasiões específicas". Um cap defensivo (`enforcePresenterCap`) força `presenter=false` além de `max_scenes_per_episode` e quando `spokesmodel.enabled=false`, independente do que o modelo tentar retornar.
- Imagem de referência do personagem é gerada **uma única vez** (não por episódio) e persistida em `system_config.spokesmodel.reference_image_url` + Storage (`branding/spokesmodel/reference.png`), reaproveitada para sempre. Cada cena com `presenter=true` gera uma nova pose condicionada a essa referência via `geminiGenerateImage({ referenceImages: [...] })` (recurso nativo do Nano Banana para consistência de personagem).
- Falha em qualquer etapa do spokesmodel (orçamento esgotado, API fora do ar, sem faturamento) cai silenciosamente no fallback já existente (afiliado/Pexels) — nunca derruba o episódio.

## Impacto e limites

- Isso **não reativa** a geração de imagem genérica do ADR-009/ADR-015: `imageGenerationEnabled: false` e os dois `hardcoded return` continuam intocados.
- `spokesmodel.enabled` nasce `false` no seed — nenhum custo é incorrido até o operador confirmar faturamento Gemini e ativar manualmente via painel/SQL.
- TikTok Shop automático **não foi implementado** nesta entrega: o usuário confirmou não ter aprovação do Partner Center; o conector do ADR-027 já cobre catálogo/link quando essa aprovação existir, sem trabalho adicional necessário agora.

## Prevenção

- Qualquer novo tipo de chamada Gemini com custo real deve seguir o mesmo padrão: tipo próprio no `GeminiCallType`, limite configurável (nunca hardcoded a menos que seja um veto deliberado), e `cost_estimate` real em `recordGeminiCall`.
- Testes cobrem: schema (`presenter` default/aceito), prompt (instrução condicional ao personagem), e o módulo `spokesmodel.ts` (geração/reuso de referência, orçamento reservado sob o kind correto, ordem das partes na chamada Gemini).
