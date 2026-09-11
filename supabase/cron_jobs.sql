-- ADR-015: schedule only implemented workers. Pipeline starts disabled in seed.
-- Prefer deploy.sh: it configures Vault and deploys functions before scheduling.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('orchestrator-daily','orchestrator-tick');
select cron.schedule('orchestrator-tick', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/orchestrator',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  )
$job$);
-- heartbeat / analytics: deploy.sh schedules them only after their implementations exist.
