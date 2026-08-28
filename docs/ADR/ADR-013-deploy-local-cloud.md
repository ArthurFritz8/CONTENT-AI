# ADR-013 — Deploy em duas etapas: Supabase local antes do Supabase Cloud

## Objetivo

Definir a estratégia operacional de deploy do CONTENT AI: validar schema/Storage localmente sem custo e só depois aplicar no Supabase Cloud com script idempotente.

## Contexto

O pipeline já tem a cadeia arquitetural principal: `idea → research → script → assets → rendered`, com renderer no GitHub Actions. O próximo risco não é desenho de domínio, é promover migrations, buckets, secrets, Edge Functions e cron sem quebrar um ambiente real.

Debate aplicado:

1. **Viabilidade:** Supabase local primeiro é correto porque permite quebrar/reaplicar migrations e Storage sem custo, especialmente antes do primeiro deploy cloud.
2. **Veto:** o script cloud não deve tentar deployar funções que ainda não existem no repositório. Hoje existem `orchestrator`, `generate-research`, `generate-script`, `generate-assets` e `trigger-render`. `publish-youtube`, `publish-tiktok`, `collect-analytics` e `heartbeat` ficam como opcionais: se a pasta existir, deploya; se não existir, avisa e pula.
3. **Sim, e além disso:** o deploy cloud também configura os secrets do GitHub Actions (`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`) quando o `gh` CLI estiver logado. Sem isso, `trigger-render` dispara o workflow, mas o runner não consegue falar com o Supabase.
4. **Fusão estratégica:** o deploy não cria states novos; ele apenas materializa a esteira já definida. O teste de fumaça opcional insere uma ideia e chama `orchestrator`, respeitando a máquina de estados.

## Solução

### Passo 1 — Local

Executar localmente antes do cloud:

```bash
npx --yes supabase@latest init
npx --yes supabase@latest start
npx --yes supabase@latest db push
psql "$SUPABASE_LOCAL_DB_URL" -f supabase/seed.sql
```

Validaçoes locais recomendadas:

- Tabelas, CHECK constraints e trigger `validate_episode_transition`.
- Trigger `update_updated_at`.
- Bucket `assets` com upload/download.
- `cron.job` apenas depois de habilitar `pg_cron`/`pg_net` localmente.
- Reaplicar migrations até o schema estabilizar; como ainda não houve deploy cloud inicial, editar migrations iniciais segue aceitável pelo precedente ADR-006.

### Passo 2 — Cloud automatizado

`deploy.sh` automatiza:

1. Carregar `.env` (ou `ENV_FILE=...`) sem imprimir valores.
2. Opcionalmente executar `supabase link` quando `SUPABASE_PROJECT_REF` estiver definido.
3. Rodar `supabase db push` no projeto linkado.
4. Aplicar `supabase/seed.sql` via `psql` (`SUPABASE_DB_URL` obrigatório para SQL arbitrário como seed, bucket e cron).
5. Criar/atualizar bucket público `assets` em `storage.buckets`.
6. Configurar Supabase secrets usados pelas Edge Functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `PEXELS_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, defaults `BUDGET_CEILING=50` e `TTS_PREFERRED_ENGINE=gemini`. Secrets futuros (`OPENROUTER_API_KEY`, Telegram, YouTube) são enviados se existirem no ambiente.
7. Deployar funções obrigatórias existentes e pular opcionais futuras ainda ausentes.
8. Configurar Vault + `pg_cron` de forma idempotente, agendando apenas jobs cujas funções existem.
9. Com `--smoke-test`, inserir a ideia de teste e chamar `orchestrator` manualmente.

### Correção do `--linked`

O prompt cita `supabase db push --linked`, mas a forma mais portável é `supabase link` uma vez e depois `supabase db push`. O script segue esse caminho para evitar depender de uma flag que varia por versão do CLI.

### Segurança

- Secrets nunca entram no git; o script lê variáveis do ambiente/`.env` local ignorado.
- `cron_jobs.sql` continua sem secrets hardcoded; o script grava `project_url` e `service_role_key` no Vault em runtime.
- O smoke test é opt-in porque consome quota e cria dados reais no cloud.

## Prevenção

- Funções obrigatórias ausentes fazem o deploy falhar cedo.
- Funções futuras ausentes apenas geram aviso, evitando falso negativo enquanto publish/analytics/heartbeat não existem.
- `SUPABASE_DB_URL` é obrigatório para seed/bucket/cron; sem ele o deploy não tenta improvisar SQL por REST.
- Buckets e crons são idempotentes: bucket usa upsert; cron remove job antigo antes de recriar.
- O checklist ponta a ponta deve ser executado após `--smoke-test`, acompanhando `episodes` e `job_events`.