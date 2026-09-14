-- Cloud scheduler bootstrap without requiring psql on the operator machine.
-- The service key is received only by this service-role RPC and stored in Vault.

do $extensions$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create schema if not exists vault;
    create extension if not exists supabase_vault with schema vault;
  end if;
end;
$extensions$;

insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do update set name = excluded.name, public = true;

create or replace function public.configure_content_ai_scheduler(
  p_project_url text,
  p_service_role_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $configure$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from pg_extension where extname = 'pg_net')
    or not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'Supabase scheduler extensions are unavailable';
  end if;
  if p_project_url !~ '^https://[a-z0-9]{20}[.]supabase[.]co$' then
    raise exception 'Invalid Supabase project URL';
  end if;
  if length(p_service_role_key) < 32 or p_service_role_key ~ '[[:space:]]' then
    raise exception 'Invalid service role credential';
  end if;

  delete from vault.secrets where name in ('project_url', 'service_role_key');
  perform vault.create_secret(p_project_url, 'project_url');
  perform vault.create_secret(p_service_role_key, 'service_role_key');

  perform cron.unschedule(jobid)
    from cron.job
   where jobname in ('orchestrator-daily', 'orchestrator-tick');

  select cron.schedule('orchestrator-tick', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1)
        || '/functions/v1/orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        'apikey',
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 140000
    );
  $job$) into v_job_id;

  return jsonb_build_object(
    'configured', true,
    'job_name', 'orchestrator-tick',
    'job_id', v_job_id,
    'schedule', '* * * * *'
  );
end;
$configure$;

revoke all on function public.configure_content_ai_scheduler(text, text)
  from public, anon, authenticated;
grant execute on function public.configure_content_ai_scheduler(text, text)
  to service_role;
