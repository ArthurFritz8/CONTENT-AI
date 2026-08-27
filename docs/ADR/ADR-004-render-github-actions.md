# ADR-004 — GitHub Actions como Renderer Primário

## Objetivo
Eliminar a dependência do PC ligado para o pipeline "tudo automático", resolvendo o problema de NAT (Supabase na nuvem não alcança `localhost:3456`) sem adicionar túnel ou serviço externo.

## Contexto
- Três opções avaliadas: (a) polling do renderer local no banco, (b) túnel (Cloudflare/ngrok), (c) GitHub Actions primário.
- Decisão do usuário: **(c)**. Matemática do budget: 2 vídeos/dia × 15 min ≈ 900 min/mês = 30% dos 3.000 min do plano Pro+. Runner Ubuntu já tem FFmpeg nativo.
- A proposta externa sugeria passar signed URLs dos assets como inputs do `workflow_dispatch` e confiava no timeout default do runner.

## Solução
`supabase/functions/trigger-render/index.ts` dispara `POST /repos/{owner}/{repo}/actions/workflows/render.yml/dispatches` com **apenas `episode_id`** como input; `.github/workflows/render.yml` busca dados direto do Supabase via secrets do repositório e atualiza estado/eventos via PostgREST.

**Correções sobre a proposta externa (peer review):**
1. **Signed URLs como inputs — VETADO**: inputs de `workflow_dispatch` aparecem nos logs/UI da run (vazamento) e signed URLs podem expirar na fila. O runner busca os assets com `SUPABASE_SERVICE_ROLE_KEY` guardada em GitHub Secrets.
2. **Timeout default de 6h — VETADO como budget risk**: job travado queimaria 360 min (12% do mês). Aplicado `timeout-minutes: 30` + `concurrency group` por `episode_id` (impede renders duplicados simultâneos).
3. **`local-renderer` como "dev-only" — PARCIALMENTE corrigido**: em vez de duplicar lógica, `apps/local-renderer` é o **único engine de render**, invocado como CLI tanto pelo Actions (produção) quanto localmente (dev/debug). DRY: um código, dois ambientes.

**Aprimoramentos proativos:**
- **Idempotência de dispatch**: `metadata.render_dispatch.dispatched_at` + TTL config-driven (`system_config.render.dispatch_ttl_minutes`, default 45min) — retry do pg_cron não dispara N renders do mesmo episódio; `force: true` permite redisparo manual.
- **Infra `_shared` criada** (exigência da Regra D, reutilizável por todas as Edge Functions): `logger.ts` (JobLogger → `job_events`), `error-handler.ts` (`AppError`, `retryWithBackoff` com jitter, respostas centralizadas), `validators.ts` (Zod), `supabase-client.ts` (service client + `getSystemConfig`), `types.ts`, `constants.ts`.
- **Workflow com caminho de falha real**: step `if: failure()` marca `failed` + `failure_reason` e grava `job_event` — nenhum render morre silenciosamente.
- Testes unitários de `retryWithBackoff`/`isTransientHttpStatus` em `error-handler.test.ts` (Deno test).

**Checkpoint mantido**: o renderer CLI (próxima etapa) salvará `render_progress` via PATCH a cada segmento; retry retoma do último checkpoint. O step "Renderizar episódio" do workflow está intencionalmente como falha explícita até o CLI existir.

## Prevenção
- `concurrency group` + TTL de dispatch = dupla proteção contra consumo duplicado de minutos.
- `timeout-minutes: 30` limita o pior caso de desperdício a 1% do budget mensal.
- Secrets só em GitHub Secrets / Supabase env — nunca em inputs, logs ou código (Trava 1).
- Trigger de transição do banco (ADR-002) rejeita PATCHes de estado ilegais vindos do runner.
- `.github/workflows/ci.yml` roda `deno test` das `_shared` a cada push (Trava 2 automatizada, timeout 10 min).
