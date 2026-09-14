#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env}"
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-latest}"
SMOKE_TEST=0
CHECK_ONLY=0

usage() {
  cat <<'EOF'
Uso: ./deploy.sh [--check] [--smoke-test]

Automatiza o deploy cloud do CONTENT AI:
  - supabase db push no projeto linkado
  - seed.sql
  - bucket assets público
  - Supabase secrets
  - Edge Functions atuais
  - Vault + pg_cron idempotente
  - smoke test opcional de infraestrutura, sem criação/publicação

Variáveis obrigatórias:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  GEMINI_API_KEY, TAVILY_API_KEY, PEXELS_API_KEY, GITHUB_TOKEN, GITHUB_REPO

Variáveis opcionais úteis:
  ENV_FILE=.env.cloud, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD,
  SUPABASE_ACCESS_TOKEN,
  OPENROUTER_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=1
      shift
      ;;
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
  supabase db push --include-seed
}

set_supabase_secrets() {
  log "Configurando Supabase secrets"
  local secret_args=(
    "GEMINI_API_KEY=$GEMINI_API_KEY"
    "TAVILY_API_KEY=$TAVILY_API_KEY"
    "PEXELS_API_KEY=$PEXELS_API_KEY"
    "GITHUB_TOKEN=$GITHUB_TOKEN"
    "GITHUB_REPO=$GITHUB_REPO"
    "GITHUB_BRANCH=$GITHUB_BRANCH"
    "BUDGET_CEILING=$BUDGET_CEILING"
    "TTS_PREFERRED_ENGINE=$TTS_PREFERRED_ENGINE"
    "CONTENT_AI_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
  )

  local optional=(
    OPENROUTER_API_KEY
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID
    TELEGRAM_USER_ID
    TELEGRAM_WEBHOOK_SECRET
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
  local name
  for name in YOUTUBE_CLIENT_ID YOUTUBE_CLIENT_SECRET YOUTUBE_REFRESH_TOKEN YOUTUBE_CHANNEL_ID; do
    if [[ -n "${!name:-}" ]]; then printf '%s' "${!name}" | gh secret set "$name" --repo "$GITHUB_REPO"; fi
  done
}

deploy_functions() {
  local required=(orchestrator generate-research generate-script generate-assets trigger-render telegram-bot publish-youtube)
  local optional=(publish-tiktok collect-analytics heartbeat)

  log "Deployando Edge Functions obrigatórias"
  for fn in "${required[@]}"; do
    [[ -d "supabase/functions/$fn" ]] || fail "Função obrigatória ausente: supabase/functions/$fn"
    supabase functions deploy "$fn" --import-map supabase/functions/deno.json --use-api
  done

  log "Verificando Edge Functions opcionais/futuras"
  for fn in "${optional[@]}"; do
    if [[ -d "supabase/functions/$fn" ]]; then
      supabase functions deploy "$fn" --import-map supabase/functions/deno.json --use-api
    else
      warn "Função opcional ausente, pulando deploy: $fn"
    fi
  done
}

configure_cron_jobs() {
  log "Configurando Vault, bucket assets e pg_cron"
  node scripts/configure-supabase-cloud.mjs
}

run_smoke_test() {
  if [[ "$SMOKE_TEST" != "1" ]]; then return; fi
  log "Smoke de infraestrutura (sem consumir ideias, IA ou publicar)"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/functions/v1/orchestrator" -H 'Content-Type: application/json' -d '{}')
  [[ "$code" == "401" ]] || fail "Endpoint aceitou chamada anônima ou não está disponível (HTTP $code)"
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$SUPABASE_URL/functions/v1/orchestrator" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  [[ "$code" == "405" ]] || fail "Worker autenticado não respondeu como esperado (HTTP $code)"
  log "Infraestrutura verificada; teste ponta a ponta ainda é obrigatório"
}

main() {
  need_cmd node
  node scripts/scan-secrets.mjs
  node scripts/preflight.mjs
  if [[ "$CHECK_ONLY" == "1" ]]; then
    log "Verificação local concluída; nenhum recurso cloud foi alterado"
    return
  fi
  need_cmd npx
  need_cmd curl
  load_env
  require_envs SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY TAVILY_API_KEY PEXELS_API_KEY GITHUB_TOKEN GITHUB_REPO

  link_project_if_requested
  push_database
  set_supabase_secrets
  set_github_actions_secrets
  deploy_functions
  configure_cron_jobs
  run_smoke_test

  log "Deploy cloud concluído"
  echo "Checklist: acompanhe episodes e job_events no Supabase para validar os estados ponta a ponta."
}

main "$@"
