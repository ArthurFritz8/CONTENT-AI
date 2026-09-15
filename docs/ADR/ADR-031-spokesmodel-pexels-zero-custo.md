# ADR-031 — Personagem fixo via pool curado de fotos Pexels (zero custo)

Status: aceito; substitui a arquitetura de geração paga do ADR-030.

## Objetivo

Entregar o personagem/apresentador fixo pedido pelo usuário sem nenhum custo — o usuário, após ver a estimativa de gasto (ADR-030), decidiu explicitamente: "não queria gastar nada".

## Contexto

O ADR-030 exigia faturamento no Google AI Studio (Nano Banana não tem free tier). Não existe gerador de imagem de IA gratuito e confiável para consistência de personagem. Alternativa zero-custo real: usar fotos **já existentes** de um banco de imagens gratuito (Pexels, já integrado ao projeto — ADR-009), escolhendo fotos de um único fotoshoot onde a mesma pessoa aparece em poses diferentes.

Busquei no Pexels e confirmei visualmente (comparação de rosto/cabelo/roupa) 7 fotos do fotógrafo "SHVETS production" que mostram a mesma mulher, mesmo cenário (fundo bege, regata bege, aparelho dental), em ângulos/poses diferentes — suficiente para funcionar como "o mesmo apresentador" reaparecendo nos vídeos.

## Decisão

- Removida por completo a implementação do ADR-030: sem novo `GeminiCallType`, sem chamada Gemini de imagem, sem `referenceImages` no cliente, sem orçamento/custo associado a este recurso.
- `packages/core/src/planners/spokesmodel-plan.ts` (função pura, testável): `pickPresenterPhoto(cfg, sceneOrder)` escolhe uma foto do pool por round-robin determinístico — sem I/O, sem custo, sem rede.
- `system_config.spokesmodel` guarda `enabled`, `character_description` (usado só no prompt do roteiro, para o modelo de texto saber descrever a cena coerentemente) e `fixed_photos[]` (7 fotos curadas, hotlink direto do CDN Pexels — mesma convenção do ADR-009, sem re-upload para Storage).
- `scenes[].presenter` (contrato `ScriptJson`, já existente) continua sendo decisão do roteiro (Gemini texto, dentro do free tier já orçado), com o mesmo cap defensivo (`enforcePresenterCap`) do ADR-030.
- Em `generate-assets`, cena com `presenter=true` e `spokesmodel.enabled=true` usa `pickPresenterPhoto` diretamente como `license:'pexels', source:'pexels'` — mesmo tratamento de qualquer outra imagem Pexels do pipeline. Sem foto disponível ou feature desligada, cai no fluxo normal (afiliado/Pexels por busca), sem quebrar o episódio.
- `enabled=false` por padrão — ativação é decisão editorial do operador (não decisão de custo, já que é gratuito).

## Impacto e limites

- As fotos mostram a apresentadora segurando um pote de creme (contexto do fotoshoot original de skincare) — não é o produto real do vídeo. Isso é consistente com a regra já vigente do projeto ("não diga que uma imagem stock é o produto real"): a cena do apresentador é um recurso editorial de marca (mesma "cara" recorrente), não uma alegação sobre o produto specific do episódio. Se isso incomodar visualmente, o pool pode ser trocado por outro fotoshoot com objeto neutro/mockup.
- Pool pequeno (7 fotos) e fixo: reaparecerão as mesmas poses entre vídeos diferentes. Aceitável para o volume atual (`max_scenes_per_episode` pequeno); pode crescer no futuro trocando/adicionando fotos no `fixed_photos[]` sem mudar código.
- TikTok Shop automático: sem mudança — segue não implementado, aguardando aprovação do Partner Center (ADR-027).

## Prevenção

- Qualquer troca futura do pool deve manter a verificação visual (mesma pessoa em todas as fotos) antes de commitar — um pool com pessoas diferentes quebraria a promessa de "personagem consistente".
- Se um dia a geração por IA voltar a ser cogitada, reler o ADR-030 antes: as duas travas do ADR-015 (`image` hardcoded em `budget-guard.ts` e em `reserve_gemini_call`) continuam vigentes e não devem ser tocadas sem decisão explícita e informada do operador sobre custo real.
