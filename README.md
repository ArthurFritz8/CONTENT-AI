# CONTENT AI

Pipeline **zero-budget** de criação e publicação automática de vídeos (YouTube + Shorts; TikTok manual até auditoria da Content Posting API).

**Estado verificado em 14/09/2026:** primeiro piloto gerado, revisado no Telegram e enviado ao YouTube como privado. Supabase, Tavily, Gemini, Pexels e fallback de voz no Actions integram o fluxo; o pipeline permanece pausado. [QA editorial](docs/ADR/ADR-016-qualidade-editorial-antes-dos-assets.md) e [evidências de pesquisa](docs/ADR/ADR-023-pesquisa-gratuita-tavily.md) continuam exigindo revisão humana. A nova [validação audiovisual e revisão com trechos das fontes](docs/ADR/ADR-025-qa-audiovisual-e-revisao-com-evidencias.md) verifica os próximos renders. Analytics, monitoramento/retencão e publicação pública/Shorts ainda faltam; TikTok segue manual. Veja a [auditoria atual](docs/auditoria-2026-09-14.md) e o [plano de implementação](docs/plano-implementacao.md).

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
| Pesquisa | Tavily Search basic | 100/mês no limite interno; plano gratuito oferece 1.000 |
| IA texto | Gemini 3.6 Flash | Free tier |
| Imagem | Produto autorizado / Pexels | Free; Nano Banana API desabilitado (ADR-015) |
| TTS | Gemini TTS → edge-tts → Piper (cadeia de fallback) | Free (ver ADR-003) |
| Render | FFmpeg — GitHub Actions primário, PC local só dev (ADR-004) | Runner padrão gratuito neste repo público; privado depende do plano GitHub |
| Publicação | YouTube Data API v3 (cotas do projeto no Google Cloud Console) | Free |
| Aprovação | Telegram Bot | Free |
| Painel | `apps/web-panel` reservado; interface ainda não implementada | — |

## Estrutura

```
├── docs/ADR/            # Registros de decisão (método O.C.S.P.)
├── supabase/
│   ├── migrations/      # Schema versionado
│   ├── functions/       # Edge Functions (Deno)
│   ├── seed.sql         # Configs padrão (budget guard etc.)
│   └── cron_jobs.sql    # Referência SQL do pg_cron; deploy automatizado pelo ADR-021
├── apps/
│   ├── local-renderer/  # Engine de render (Node.js) — mesmo código roda no Actions e em dev local
│   └── web-panel/       # Pacote reservado para painel futuro
├── packages/core/       # Prompts, schemas Zod, validadores compartilhados
└── .github/workflows/   # Assets, render, piloto YouTube e CI
```

## Setup

O [piloto privado do YouTube](docs/youtube-private-pilot.md) envia a versão horizontal aprovada pelo Telegram, com retomada e proteção contra duplicação. O primeiro upload real e sua repetição idempotente foram concluídos; o operador confirmou o vídeo no Studio. Publicação pública e analytics continuam pendentes.

No [Telegram](docs/telegram-review.md), use `/ideia` para cadastrar pautas, `/fila` para acompanhar e `/cancelar` para retirar ideias pendentes. A revisão do vídeo continua separada da entrada de ideias.

1. Node22.15+ e `npm ci`.
2. Copie `.env.example` → `.env` e preencha as chaves (nunca commitar `.env`).
3. `bash deploy.sh --check` verifica o código local; não faz deploy.
4. Siga o [plano de deploy e smoke](docs/plano-implementacao.md). Pipeline inicia pausado (`pipeline.enabled=false`). `--smoke-test` verifica infraestrutura, sem inserir ideia ou publicar.
5. `node scripts/preflight.mjs --production` lista módulos obrigatórios ausentes; ainda não é possível certificar o pipeline completo.

## Processo de desenvolvimento

Toda feature/bugfix segue: **análise → ADR (`docs/ADR/`) → código → DoD → Conventional Commit → push**.
Regras completas nos ADRs 001–003.
