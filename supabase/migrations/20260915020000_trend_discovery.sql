-- ADR-032: descoberta automática de tendências (Tavily + Hacker News, gratuitos,
-- sem restrição de uso comercial), alimentando idea_queue como SUGESTÃO de baixa
-- prioridade — nunca substitui a curadoria humana (ADR-007 continua a fonte principal).

alter table public.idea_queue
  add column source text not null default 'manual' check (source in ('manual', 'trend_discovery')),
  add column dedupe_key text;

-- evita redescobrir o mesmo item em execuções futuras do discover-trends
create unique index idea_queue_trend_dedupe
  on public.idea_queue (dedupe_key)
  where source = 'trend_discovery' and dedupe_key is not null;

alter table public.job_events drop constraint job_events_event_type_check;
alter table public.job_events add constraint job_events_event_type_check check (event_type in (
  'script_generated','assets_generated','render_started','render_completed',
  'render_checkpoint_saved','qa_passed','qa_failed','publish_started',
  'publish_completed','analyze_completed','heartbeat_sent','budget_exceeded',
  'failed','tts_fallback_triggered','state_transition','approval_received','approval_rejected',
  'tts_engine_selected','tts_consistency_regeneration','research_completed','gemini_call','tavily_call',
  'images_generated','tts_generated','subtitles_generated','trend_discovered'
));

-- desativado por padrão: exige ativação explícita do operador (mesmo padrão de spokesmodel/pipeline)
insert into public.system_config (key, value) values
  ('trend_discovery', '{
    "enabled": false,
    "max_pending": 5,
    "query": null
  }'::jsonb)
on conflict (key) do nothing;

-- Agenda discover-trends 1x/dia junto com o orchestrator-tick existente. Seguro por
-- padrão: a função checa trend_discovery.enabled=false e sai sem custo (mesmo
-- padrão do orchestrator com pipeline.enabled).
create or replace function public.configure_content_ai_scheduler(
  p_project_url text,
  p_service_role_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $configure$
declare
  v_tick_job_id bigint;
  v_trends_job_id bigint;
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
   where jobname in ('orchestrator-daily', 'orchestrator-tick', 'discover-trends-daily');

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
  $job$) into v_tick_job_id;

  select cron.schedule('discover-trends-daily', '0 13 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1)
        || '/functions/v1/discover-trends',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        'apikey',
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$) into v_trends_job_id;

  return jsonb_build_object(
    'configured', true,
    'jobs', jsonb_build_array(
      jsonb_build_object('job_name', 'orchestrator-tick', 'job_id', v_tick_job_id, 'schedule', '* * * * *'),
      jsonb_build_object('job_name', 'discover-trends-daily', 'job_id', v_trends_job_id, 'schedule', '0 13 * * *')
    )
  );
end;
$configure$;

revoke all on function public.configure_content_ai_scheduler(text, text) from public, anon, authenticated;
grant execute on function public.configure_content_ai_scheduler(text, text) to service_role;
