# ADR-009 — generate-assets: cadeia de fallback de imagens por role da cena

## Objetivo

Implementar a transição `script → assets` com seleção hierárquica de fonte de imagem por role (`hook`/`content`/`cta`), quota guard preditivo para geração de imagem e suporte a imagem oficial do afiliado (`product_image_url`).

## Contexto

- O hook decide a retenção nos 3 primeiros segundos e frequentemente exige o produto específico — banco de imagens não tem. A imagem oficial do afiliado (TikTok Shop/Amazon) é a melhor fonte e custa zero de cota.
- O free tier do Nano Banana (geração de imagem Gemini) **segue não confirmado**; a arquitetura não pode depender dele.
- Proposta externa sugeria roles `claim/evidence`, `counterpoint` e `disclosure` — **vetado**: o contrato (ADR-005/008) define `hook | content | cta` com invariantes; seleção de asset não justifica emenda de contrato editorial. Cena "disclosure" não existe (disclosure é narração no CTA) e o nível "estático via FFmpeg" foi vetado também por impossibilidade técnica: **Edge Functions Deno não executam FFmpeg**.
- Proposta de persistir signed URLs **vetada**: expiram (mesmo racional do ADR-004).

## Solução

### Cadeia por role (mapeada para o contrato real)
| Role | P1 | P2 | P3 |
|---|---|---|---|
| hook | afiliado (`product_image_url`) | Nano Banana | Pexels |
| content | Nano Banana | Pexels | — |
| cta | Pexels (sempre — nunca gasta cota) | — | — |

### Planner puro no core
`planAssetSources()` em `packages/core/src/planners/asset-plan.ts`: recebe cenas + `hasAffiliateImage` + `imageGenerationEnabled` + `imageQuotaRemaining` e devolve o plano por cena. Alocação de cota por prioridade: hook primeiro, depois contents em ordem. Função pura → 6 testes em Node; a Edge Function só executa o plano.

### Quota guard preditivo
- Novo helper `getGeminiBudgetRemaining(db, 'image')` no budget-guard (reusa a contagem de eventos `gemini_call` do ADR-008 — a proposta de "tracking separado" era redundante, já existia).
- O plano é calculado com a quota restante ANTES de qualquer chamada; cada geração ainda passa por `assertGeminiBudget` + `recordGeminiCall` (defesa em profundidade).
- Flag `assets.image_generation_enabled=false` no seed: Nano Banana desligado até o free tier ser confirmado. O pipeline funciona hoje com afiliado + Pexels.

### product_image_url
- Coluna nova em `idea_queue` e `episodes`; `consume_next_idea()` copia ao consumir.
- Imagem do afiliado é baixada (validação: content-type `image/*`, máx. 5MB configurável), re-hospedada no Storage (URL de origem pode morrer) e **reaproveitada** entre cenas — download único.

### Armazenamento e licenças
- Gerada/afiliado: upload no bucket `assets` (`episodes/{id}/...`), URL pública canônica (não signed).
- Pexels: **hotlink direto do CDN** (permitido pela licença, poupa o 1GB free do Storage), `author` preenchido com o fotógrafo.
- Imagem única (gerada/afiliado) alimenta `asset_landscape` E `asset_portrait` — renderer faz cover-crop por orientação. Pexels entrega as duas orientações numa única busca (`src.landscape`/`src.portrait`).
- Mapeamento: afiliado → `license='own', source='affiliate'` (enum `source` ganhou `'affiliate'` no CHECK e no `assetRefSchema`); gerada → `'generated'/'gemini'`; Pexels → `'pexels'/'pexels'`.

### Fluxo da function
1. Exige `status='script'`; parse do `script_json` com `scriptJsonSchema`.
2. Executa plano por cena; Pexels sem resultado → retry com `assets.pexels_fallback_query`; ainda vazio → `failed` com `failure_reason='assets_generation_failed'`.
3. Revalida o script resolvido (Zod + `isRenderReady`) — `script_hash` não muda porque assets estão fora do hash editorial (ADR-005/006).
4. Insere linhas em `assets`, atualiza `script_json` + `status='assets'`, evento `assets_generated` com `{affiliate, generated, pexels, total_scenes}`.
5. `render_progress` NÃO é tocado — pertence ao render (ADR-004).

### OpenRouter (sugestão do operador)
Aprovado como **fallback de texto** futuro: modelos `:free` (~50 req/dia) podem assumir geração de roteiro quando a quota Gemini de texto esgotar. **Não entra na cadeia de assets** — geração de imagem no OpenRouter é paga. Implementação adiada: exigirá provider chain no cliente de texto (`gemini → openrouter`) e chave `OPENROUTER_API_KEY`; nada disso bloqueia o pipeline atual.

## Prevenção

- Seleção de fonte de asset NUNCA vira campo do contrato editorial — é decisão de runtime do planner.
- Toda fonte nova de imagem entra primeiro no enum do CHECK + `assetRefSchema` + mapeamento de licença; sem isso o insert falha.
- Nunca persistir signed URLs; nunca hotlink de imagem de afiliado (re-hospedar sempre).
- Qualquer chamada de geração de imagem DEVE passar por `assertGeminiBudget('image')` mesmo com plano pré-calculado — o plano pode ficar obsoleto entre cálculo e execução.
- Migrations iniciais editadas diretamente (precedente ADR-006 — schema ainda não aplicado); após primeiro deploy, coluna nova = migration nova.
