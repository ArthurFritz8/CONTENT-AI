# CONTENT AI

Pipeline **zero-budget** de criação e publicação automática de vídeos (YouTube + Shorts; TikTok manual até auditoria da Content Posting API).

**Estado verificado (ADR-015):** implementação até `review`, com configuração cloud ainda pendente. QA, bot de aprovação, publishers e analytics ainda não foram implementados. [Auditoria por eixo](docs/auditoria-2026-09-11.md) e [plano de implementação](docs/plano-implementacao.md) registram os bloqueios e critérios de aceite. TikTok segue manual: o caso de uso privado atual conflita com as regras da API.

## Fluxo (máquina de estados)

```
idea → research → script → assets → rendered → review → published → analyze
                                                  ↑ (qualquer estado pode ir para `failed`)
```

- Gate humano obrigatório via **Telegram Bot** antes de publicar.
- Idempotência via `script_hash` antes de qualquer publicação.
- Checkpoint de render via `render_progress` (0–100).
- Disclosure: `containsSyntheticMedia=true` (YouTube), `commercial_content=true` (TikTok com produto).

## Stack

| Camada | Tecnologia | Custo |
|---|---|---|
| Orquestração | Supabase Edge Functions (Deno) + pg_cron | Free tier |
| Banco | Supabase Postgres (máquina de estados auditável) | Free tier |
| IA texto | Gemini Flash / Flash-Lite | Free tier |
| Imagem | Produto autorizado / Pexels | Free; Nano Banana API desabilitado (ADR-015) |
| TTS | Gemini TTS → edge-tts → Piper (cadeia de fallback) | Free (ver ADR-003) |
| Render | FFmpeg — GitHub Actions primário, PC local só dev (ADR-004) | Runner padrão gratuito neste repo público; privado depende do plano GitHub |
| Publicação | YouTube Data API v3 (10.000 units/dia) | Free |
| Aprovação | Telegram Bot | Free |
| Painel | Next.js (`apps/web-panel`) | Local |

## Estrutura

```
├── docs/ADR/            # Registros de decisão (método O.C.S.P.)
├── supabase/
│   ├── migrations/      # Schema versionado
│   ├── functions/       # Edge Functions (Deno)
│   ├── seed.sql         # Configs padrão (budget guard etc.)
│   └── cron_jobs.sql    # pg_cron via Vault (aplicar manualmente — ver ADR-002)
├── apps/
│   ├── local-renderer/  # Engine de render (Node.js) — mesmo código roda no Actions e em dev local
│   └── web-panel/       # Painel de fila/aprovação (Next.js)
├── packages/core/       # Prompts, schemas Zod, validadores compartilhados
└── .github/workflows/   # Render remoto + health-check
```

## Setup

1. Node22.15+ e `npm ci`.
2. Copie `.env.example` → `.env` e preencha as chaves (nunca commitar `.env`).
3. `bash deploy.sh --check` verifica o código local; não faz deploy.
4. Siga o [plano de deploy e smoke](docs/plano-implementacao.md). Pipeline inicia pausado (`pipeline.enabled=false`). `--smoke-test` verifica infraestrutura, sem inserir ideia ou publicar.
5. `node scripts/preflight.mjs --production` lista módulos obrigatórios ausentes; ainda não é possível certificar o pipeline completo.

## Processo de desenvolvimento

Toda feature/bugfix segue: **análise → ADR (`docs/ADR/`) → código → DoD → Conventional Commit → push**.
Regras completas nos ADRs 001–003.
