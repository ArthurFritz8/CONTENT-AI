# CONTENT AI

Pipeline **zero-budget** de criação e publicação automática de vídeos (YouTube + Shorts; TikTok manual até auditoria da Content Posting API).

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
| IA imagem | Gemini Nano Banana | A validar (ver ADR-001) |
| TTS | Gemini TTS → edge-tts → Piper (cadeia de fallback) | Free (ver ADR-003) |
| Render | FFmpeg — GitHub Actions primário, PC local só dev (ADR-004) | 3.000 min/mês (Pro+) |
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

1. `npm install`
2. Copie `.env.example` → `.env` e preencha as chaves (nunca commitar `.env`).
3. `supabase link --project-ref <ref>` e `supabase db push`.
4. Aplique `supabase/cron_jobs.sql` no SQL Editor **após** cadastrar segredos no Vault (instruções no próprio arquivo).

## Processo de desenvolvimento

Toda feature/bugfix segue: **análise → ADR (`docs/ADR/`) → código → DoD → Conventional Commit → push**.
Regras completas nos ADRs 001–003.
