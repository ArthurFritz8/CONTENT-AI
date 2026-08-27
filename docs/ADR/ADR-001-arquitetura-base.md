# ADR-001 — Arquitetura Base do Monorepo

## Objetivo
Estabelecer a fundação técnica de um pipeline 100% free tier para criação e publicação automática de vídeos (YouTube + Shorts; TikTok manual até auditoria da API), com custo mensal alvo de R$ 0, operado por uma única pessoa, com gate humano obrigatório antes de qualquer publicação.

## Contexto
- Projeto pessoal de longo prazo, zero-budget: qualquer dependência paga é vetada por definição.
- Validação prévia (pesquisa em docs oficiais, 2026-08): Supabase free tier (500MB Postgres, 500k invocações Edge Functions/mês, pausa após 1 semana de inatividade — mitigada pelo heartbeat diário), Gemini Flash/Flash-Lite free tier confirmado para texto, GitHub Actions 3.000 min/mês (plano Pro+ do usuário confirmado), YouTube Data API 10.000 units/dia, Pexels 200 req/h + 20.000 req/mês.
- **Risco aberto**: Gemini Nano Banana (geração de imagem) aparece como "Indisponível" na coluna free tier da página oficial de preços — pode exigir billing. Decisão do usuário: prosseguir e trocar de estratégia se a API recusar (fallback candidato: só Pexels para visuais).

## Solução
Monorepo TypeScript com npm workspaces + Turborepo:
- `supabase/` — Postgres (fonte da verdade + máquina de estados) e Edge Functions (Deno) para orquestração.
- `apps/local-renderer/` — Node.js: FFmpeg, cadeia TTS, whisper.cpp (legendas), bot Telegram de aprovação.
- `apps/web-panel/` — Next.js: fila, episódios, analytics.
- `packages/core/` — prompts versionados, schemas Zod, validadores compartilhados (fact-checker, hash, budget).
- `.github/workflows/` — render remoto (workflow_dispatch) e health-check.

**Correções aplicadas sobre a proposta original (peer review):**
1. Workflows movidos de `github-actions/` para `.github/workflows/` — GitHub só executa workflows nesse caminho; a pasta proposta seria ignorada silenciosamente.
2. Migration renomeada de `001_initial_schema.sql` para `20260826000000_initial_schema.sql` — o Supabase CLI exige prefixo timestamp para ordenar e aplicar migrations via `supabase db push`.
3. RLS habilitado em todas as tabelas (sem policies): sem isso, a `anon key` exporia todos os dados via PostgREST. Somente `service_role` (Edge Functions) acessa o banco.

## Prevenção
- `.gitignore` bloqueia `.env`, modelos binários e saídas de render desde o commit 0.
- `tsconfig.base.json` com `strict: true` herdado por todos os workspaces — impossível criar workspace não-estrito sem alterar a base (o que exigiria novo ADR).
- Trava 1 (scan de segredos) executada antes de todo commit; Trava 2 (DoD) como checklist obrigatório.
- Todo desvio arquitetural futuro exige novo ADR sequencial nesta pasta.
