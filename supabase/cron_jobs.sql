-- CONTENT AI — pg_cron jobs (aplicar MANUALMENTE no SQL Editor, 1x, após setup do Vault)
-- NAO está em migrations/ de propósito: cron.schedule com service_role_key hardcoded
-- vazaria segredo no git (Trava 1). Padrão oficial Supabase: segredos no Vault.
-- Detalhes no ADR-002.

-- PASSO 1 — cadastrar segredos no Vault (rodar uma única vez, substituindo os valores):
-- select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
-- select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'service_role_key');

-- PASSO 2 — habilitar extensões (no hosted já vêm disponíveis):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- PASSO 3 — agendar jobs:

-- Heartbeat diário 09:00 UTC → Telegram (health-check sem serviço externo)
select cron.schedule('heartbeat-daily', '0 9 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/heartbeat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
$$);

-- Orquestrador diário 01:00 UTC (avança episódios na máquina de estados)
select cron.schedule('orchestrator-daily', '0 1 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
$$);

-- Analytics semanal (segunda 10:00 UTC) — retroalimenta ideias
select cron.schedule('analytics-weekly', '0 10 * * 1', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/collect-analytics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  )
$$);
