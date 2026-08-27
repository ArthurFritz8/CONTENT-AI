# ADR-002 — Máquina de Estados Auditável

## Objetivo
Garantir que todo episódio percorra um fluxo previsível, auditável e recuperável — do rascunho da ideia à análise pós-publicação — sem possibilidade de pular o gate humano ou publicar duplicado.

## Contexto
- Pipeline autônomo com múltiplos pontos de falha externos (Gemini, Pexels, FFmpeg, YouTube API, Telegram).
- Sem máquina de estados imposta pelo banco, bugs de código poderiam pular estados (ex.: publicar sem aprovação) — risco inaceitável dado o gate humano ser requisito inegociável.
- A proposta original definia os estados mas confiava a validação de transições apenas ao código da aplicação.

## Solução
Estados: `idea → research → script → assets → rendered → review → published → analyze`, com `failed` alcançável de qualquer estado.

Implementado em `supabase/migrations/20260826000000_initial_schema.sql`:
1. **Trigger `validate_episode_transition`** (aprimoramento proativo): o Postgres rejeita transições ilegais com exception. Transições extras legítimas: `review → script|assets` (botão "Refazer" do Telegram) e `failed → <qualquer estado do pipeline>` (retry).
2. **Constraint `failed_requires_reason`**: `status='failed'` exige `failure_reason` preenchido.
3. **Idempotência**: `script_hash TEXT UNIQUE` — mesmo roteiro nunca gera dois episódios/publicações.
4. **Checkpoint de render**: `render_progress INT 0-100` — retomada sem re-render completo após timeout do runner.
5. **Auditoria**: `job_events` com CHECK de `event_type`; adicionados `state_transition`, `approval_received`, `approval_rejected` (ausentes na proposta original, mas essenciais para auditar o gate humano).
6. **Prompts versionados**: `prompt_versions` com índice único parcial `(name) WHERE is_active` — no máximo 1 versão ativa por prompt (a proposta original permitia ambiguidade).
7. **Heartbeat**: pg_cron diário → Edge Function → Telegram (também evita pausa do projeto free por inatividade).

**Correção crítica (Trava 1):** os `cron.schedule` da proposta original embutiam a `SERVICE_ROLE_KEY` literal na migration — segredo versionado no git. Movidos para `supabase/cron_jobs.sql` (aplicação manual única), lendo `project_url` e `service_role_key` do **Supabase Vault** (`vault.decrypted_secrets`), padrão documentado pela Supabase.

## Prevenção
- Trigger de transição = trava no banco: nenhum bug de aplicação consegue pular o `review`.
- Testes unitários futuros (Regra D) cobrirão: transição ilegal rejeitada, `failed` sem reason rejeitado, colisão de `script_hash`.
- Qualquer novo estado ou transição exige novo ADR + migration — nunca alteração ad-hoc.
