#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-latest}"
STORAGE_BUCKET="${STORAGE_BUCKET:-assets}"
SMOKE_TEST=0

usage() {
  cat <<'EOF'
Uso: ./deploy.sh [--smoke-test]

Automatiza o deploy cloud do CONTENT AI:
  - supabase db push no projeto linkado
  - seed.sql
  - bucket assets público
  - Supabase secrets
  - Edge Functions atuais
  - Vault + pg_cron idempotente
  - smoke test opcional (insere idea_queue e chama orchestrator)

Variáveis obrigatórias:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL,
  GEMINI_API_KEY, PEXELS_API_KEY, GITHUB_TOKEN, GITHUB_REPO

Variáveis opcionais úteis:
  ENV_FILE=.env.cloud, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD,
  OPENROUTER_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke-test)
      SMOKE_TEST=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
fail() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatório não encontrado: $1"
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Carregando variáveis de $ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  else
    warn "Arquivo $ENV_FILE não encontrado; usando variáveis já exportadas no ambiente"
  fi
  GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
  BUDGET_CEILING="${BUDGET_CEILING:-50}"
  TTS_PREFERRED_ENGINE="${TTS_PREFERRED_ENGINE:-gemini}"
}

require_envs() {
  local missing=()
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "Variáveis obrigatórias ausentes: ${missing[*]}"
  fi
}

supabase() {
  npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
}

psql_cloud() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"
}

link_project_if_requested() {
  if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
    log "Linkando projeto Supabase ($SUPABASE_PROJECT_REF)"
    local args=(link --project-ref "$SUPABASE_PROJECT_REF")
    if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
      args+=(--password "$SUPABASE_DB_PASSWORD")
    fi
    supabase "${args[@]}"
  else
    warn "SUPABASE_PROJECT_REF ausente; assumindo projeto já linkado pelo Supabase CLI"
  fi
}

push_database() {
  log "Aplicando migrations no Supabase Cloud"
  supabase db push

  log "Aplicando seed.sql (bootstrap insert-only)"
  psql_cloud -f supabase/seed.sql
}

upsert_storage_bucket() {
  log "Criando/atualizando bucket público '$STORAGE_BUCKET'"
  psql_cloud -v storage_bucket="$STORAGE_BUCKET" <<'SQL'
insert into storage.buckets (id, name, public)
values (:'storage_bucket', :'storage_bucket', true)
on conflict (id) do update set public = true, name = excluded.name;
SQL
}

set_supabase_secrets() {
  log "Configurando Supabase secrets"
  local secret_args=(
    "SUPABASE_URL=$SUPABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
    "GEMINI_API_KEY=$GEMINI_API_KEY"
    "PEXELS_API_KEY=$PEXELS_API_KEY"
    "GITHUB_TOKEN=$GITHUB_TOKEN"
    "GITHUB_REPO=$GITHUB_REPO"
    "GITHUB_BRANCH=$GITHUB_BRANCH"
    "BUDGET_CEILING=$BUDGET_CEILING"
    "TTS_PREFERRED_ENGINE=$TTS_PREFERRED_ENGINE"
  )

  local optional=(
    OPENROUTER_API_KEY
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID
    YOUTUBE_CLIENT_ID
    YOUTUBE_CLIENT_SECRET
    YOUTUBE_REFRESH_TOKEN
  )
  for name in "${optional[@]}"; do
    if [[ -n "${!name:-}" ]]; then
      secret_args+=("$name=${!name}")
    else
      warn "Secret opcional $name ausente; será necessário antes das funções futuras que o usam"
    fi
  done

  supabase secrets set "${secret_args[@]}"
}

set_github_actions_secrets() {
  if [[ "${CONFIGURE_GITHUB_ACTIONS_SECRETS:-1}" != "1" ]]; then
    warn "CONFIGURE_GITHUB_ACTIONS_SECRETS=0; pulando secrets do GitHub Actions"
    return
  fi
  if ! command -v gh >/dev/null 2>&1; then
    warn "gh CLI não encontrado; configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no GitHub Actions manualmente"
    return
  fi
  log "Configurando GitHub Actions secrets para $GITHUB_REPO"
  printf '%s' "$SUPABASE_URL" | gh secret set SUPABASE_URL --repo "$GITHUB_REPO"
  printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | gh secret set SUPABASE_SERVICE_ROLE_KEY --repo "$GITHUB_REPO"
}

deploy_functions() {
  local required=(orchestrator generate-research generate-script generate-assets trigger-render)
  local optional=(publish-youtube publish-tiktok collect-analytics heartbeat)

  log "Deployando Edge Functions obrigatórias"
  for fn in "${required[@]}"; do
    [[ -d "supabase/functions/$fn" ]] || fail "Função obrigatória ausente: supabase/functions/$fn"
    supabase functions deploy "$fn"
  done

  log "Verificando Edge Functions opcionais/futuras"
  for fn in "${optional[@]}"; do
    if [[ -d "supabase/functions/$fn" ]]; then
      supabase functions deploy "$fn"
    else
      warn "Função opcional ausente, pulando deploy: $fn"
    fi
  done
}

configure_vault_and_cron_base() {
  log "Configurando Vault, pg_cron e pg_net"
  psql_cloud \
    -v project_url="$SUPABASE_URL" \
    -v service_role_key="$SUPABASE_SERVICE_ROLE_KEY" <<'SQL'
create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

delete from vault.secrets where name in ('project_url', 'service_role_key');
select vault.create_secret(:'project_url', 'project_url');
select vault.create_secret(:'service_role_key', 'service_role_key');
SQL
}

schedule_cron_if_function_exists() {
  local job_name="$1"
  local schedule="$2"
  local function_name="$3"

  if [[ ! -d "supabase/functions/$function_name" ]]; then
    warn "Cron $job_name pulado: função $function_name ainda não existe"
    return
  fi

  log "Agendando cron $job_name -> $function_name"
  psql_cloud \
    -v job_name="$job_name" \
    -v schedule="$schedule" \
    -v function_name="$function_name" <<'SQL'
select cron.unschedule(jobid) from cron.job where jobname = :'job_name';
select cron.schedule(:'job_name', :'schedule', format($body$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/%s',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := '{}'::jsonb
  )
$body$, :'function_name'));
SQL
}

configure_cron_jobs() {
  configure_vault_and_cron_base
  schedule_cron_if_function_exists "orchestrator-daily" "0 1 * * *" "orchestrator"
  schedule_cron_if_function_exists "heartbeat-daily" "0 9 * * *" "heartbeat"
  schedule_cron_if_function_exists "analytics-weekly" "0 10 * * 1" "collect-analytics"
}

run_smoke_test() {
  if [[ "$SMOKE_TEST" != "1" ]]; then
    warn "Smoke test pulado; rode ./deploy.sh --smoke-test para inserir ideia e chamar orchestrator"
    return
  fi

  log "Inserindo ideia de teste na idea_queue"
  psql_cloud <<'SQL'
insert into idea_queue (briefing, niche, category, priority)
values (
  'Chuveiro inteligente com sensor de presença | Economiza 40% de água | Teste de pipeline',
  'gadgets_produtos_inovadores',
  'home_innovations',
  10
);
SQL

  log "Chamando orchestrator manualmente"
  curl -fsS -X POST "$SUPABASE_URL/functions/v1/orchestrator" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{}'
  printf '\n'
}

main() {
  need_cmd npx
  need_cmd psql
  need_cmd curl
  load_env
  require_envs SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL GEMINI_API_KEY PEXELS_API_KEY GITHUB_TOKEN GITHUB_REPO

  link_project_if_requested
  push_database
  upsert_storage_bucket
  set_supabase_secrets
  set_github_actions_secrets
  deploy_functions
  configure_cron_jobs
  run_smoke_test

  log "Deploy cloud concluído"
  echo "Checklist: acompanhe episodes e job_events no Supabase para validar os estados ponta a ponta."
}

main "$@"