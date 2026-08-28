# ADR-008 — Pipeline de geração em duas fases: research (grounding) e script (responseSchema)

## Objetivo

Implementar a geração de conteúdo do episódio em duas Edge Functions distintas — `generate-research` (fase 1, `idea → research`) e `generate-script` (fase 2, `research → script`) — com validação Zod, repair loop limitado e budget guard por tipo de chamada Gemini.

## Contexto

- A API do Gemini **não permite combinar Google Search grounding e `responseSchema` na mesma chamada**. Pesquisa factual e estruturação de JSON precisam ser chamadas separadas — a arquitetura em duas fases não é opção estética, é restrição técnica.
- Grounding é o recurso mais escasso do free tier (500 req/dia compartilhados entre projetos). Uma falha de validação de JSON na geração de script **não pode** desperdiçar uma nova chamada de grounding.
- O estado `research` já existia na máquina de estados (ADR-002), mas não havia persistência do resultado da pesquisa: sem checkpoint, retry de script refaria a pesquisa inteira.
- O nicho (ADR-007) exige fact-check low-medium: claims precisam de fonte real e o roteiro só pode usar fatos pesquisados.

## Solução

### Fase 1 — `generate-research`
- Exige `status='idea'` e `briefing.text`; Gemini Flash com `tools:[{google_search:{}}]`, temperatura 0.3.
- Saída validada por `researchDataSchema` (novo, em `packages/core/src/schemas/research.ts`): array de 1-20 claims `{claim, source_url (URL válida), confidence 0-1, query_used}`.
- Persistida em `episodes.research_data` (coluna `jsonb` nova) + transição para `research` + evento `research_completed`.
- **Sem repair loop na fase 1**: repair refaria a chamada de grounding cara. Falha de validação → `failed` com `failure_reason='research_validation_failed'`, recuperável via `failed → idea` (retry manual barato de auditar).

### Fase 2 — `generate-script`
- Exige `status='research'` + `research_data` válido; Gemini Flash **sem grounding**, com `responseMimeType='application/json'` + `responseSchema` (subset OpenAPI: tipos UPPERCASE, enums para role/transition/ken_burns/subtitle_position).
- O responseSchema **omite deliberadamente** campos de sistema (`episode_id`, `prompt_version`, `music`, `asset_landscape/portrait`, `gap_seconds`): o modelo nunca os controla.
- **Normalização pós-parse** (`normalizeSystemFields`): injeta `episode_id`, `prompt_version` (de `prompt_versions` ativa, fallback `1.0.0`), `music=null`, assets de cena `null`, força `contains_synthetic_media=true` e `commercial_content` derivado de `episode.product_compliance`. Isso **elimina uma classe inteira de erros do repair loop** — o modelo não pode errar o que não gera.
- Validação com `scriptJsonSchema` (fonte única do core, ADR-005). **Repair loop máx. 1 retry**: erros do Zod formatados (`path: message`) + JSON inválido embutidos em `buildRepairPrompt`. Segunda falha → `failed` com `failure_reason='json_validation_failed'`.
- Colisão de `script_hash` UNIQUE (Postgres `23505`) → `failed` com `failure_reason='duplicate_script'` (idempotência editorial, ADR-005).
- Sucesso: grava `script_json`, `script_hash`, `prompt_version`, `metadata`, `status='script'`, evento `script_generated` com `attempts` e tokens.

### Contrato — emenda ao ADR-005
- `sceneSchema` ganhou `role: 'hook' | 'content' | 'cta'` com invariantes no `superRefine` (primeira=hook, última=cta, meio=content). Antes, "primeira cena é o gancho" era regra de prompt não verificável; agora é constraint validável e o repair loop consegue apontá-la.

### Budget guard por tipo de chamada
- Novo evento `gemini_call` em `job_events` com `metadata.call_type ∈ {grounding, text, image}` + tokens (`usageMetadata`). Cada chamada real à API é auditável.
- `assertGeminiBudget(db, logger, episodeId, callType)` conta os eventos do dia (UTC) via `metadata->>call_type` e compara com `system_config.budget`: `gemini_grounding_requests_per_day_max` (20), `gemini_requests_per_day_max` (100), `gemini_image_requests_per_day_max` (10). Excedeu → evento `budget_exceeded` + `AppError 429 BUDGET_EXCEEDED`.
- Racional: grounding e texto têm custos/quotas radicalmente diferentes; um contador único mascararia esgotamento do recurso escasso.

### Fonte única de verdade entre Node e Deno
- `supabase/functions/deno.json` com import map (`zod`, `@supabase/supabase-js`) permite que as Edge Functions importem schemas e prompts do core por caminho relativo (`../../../packages/core/src/...`). Zod é a mesma versão (3.23.8) nos dois mundos.
- **Fallback documentado**: se o bundler do `supabase functions deploy` não resolver imports fora de `supabase/functions/`, copiar os schemas para `_shared/` com comentário de origem (aceitável como último recurso; a fonte canônica permanece no core).

### Infra compartilhada nova
- `_shared/gemini.ts`: cliente fetch REST (`generativelanguage.googleapis.com/v1beta`), retry com backoff apenas em status transitório, guarda que rejeita grounding+responseSchema juntos, `extractJson` tolerante a cercas markdown.
- `_shared/episode-utils.ts`: `markEpisodeFailed` (DRY — update status/failure_reason + evento `failed`).
- Seed: novo config `gemini` (`research_model`, `text_model`, `research_max_claims`, `script_temperature`) — zero hardcoded de modelo nas functions.

## Prevenção

- **Nunca** combinar grounding e responseSchema na mesma chamada — o cliente `geminiGenerate` lança erro se tentarem.
- **Nunca** deixar o modelo gerar campos de sistema; toda nova propriedade "do pipeline" no script_json deve entrar em `normalizeSystemFields`, não no prompt.
- Repair loop é sempre limitado (máx. 1 retry) e nunca dispara nova chamada de grounding.
- Toda chamada Gemini nova (qualquer function futura) DEVE passar por `assertGeminiBudget` + `recordGeminiCall` — sem exceções, ou o budget guard fica cego.
- Migration inicial editada diretamente (coluna `research_data`, event_types novos) porque nenhum ambiente aplicou o schema ainda (precedente ADR-006); após o primeiro deploy, mudanças exigem migration nova.
