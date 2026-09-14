-- ADR-023: automatic research remains inside free tiers for new Gemini projects.
alter table public.job_events drop constraint job_events_event_type_check;
alter table public.job_events add constraint job_events_event_type_check check (event_type in (
  'script_generated','assets_generated','render_started','render_completed',
  'render_checkpoint_saved','qa_passed','qa_failed','publish_started',
  'publish_completed','analyze_completed','heartbeat_sent','budget_exceeded',
  'failed','tts_fallback_triggered','state_transition','approval_received','approval_rejected',
  'tts_engine_selected','tts_consistency_regeneration','research_completed','gemini_call','tavily_call',
  'images_generated','tts_generated','subtitles_generated'
));

update public.system_config set value = value || jsonb_build_object(
  'gemini_research_requests_per_day_max', 20,
  'tavily_search_requests_per_month_max', 100,
  'tavily_search_requests_per_minute_max', 5
) where key = 'budget';
update public.system_config set value = value || jsonb_build_object('research_max_sources', 5) where key = 'gemini';

create or replace function public.reserve_gemini_call(p_kind text, p_model text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; kind_cap integer; model_cap integer; rpm integer;
  day_key text := to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD');
  minute_key text := to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
  k text; caps integer[]; scopes text[]; periods text[]; i integer;
begin
  if p_kind not in ('grounding','research','text','tts','image') then raise check_violation using message='Invalid call kind'; end if;
  select value into strict cfg from public.system_config where key='budget';
  if p_kind='image' then return false; end if;
  k := case p_kind when 'text' then 'gemini_requests_per_day_max' when 'research' then 'gemini_research_requests_per_day_max'
    else 'gemini_'||p_kind||'_requests_per_day_max' end;
  kind_cap := (cfg->>k)::integer;
  model_cap := (cfg->'gemini_models'->p_model->>'rpd')::integer;
  rpm := (cfg->'gemini_models'->p_model->>'rpm')::integer;
  if kind_cap is null or model_cap is null or rpm is null or least(kind_cap,model_cap,rpm)<1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('content-ai-gemini-budget'));
  scopes := array['gemini:kind:'||p_kind,'gemini:model:'||p_model,'gemini:rpm:'||p_model];
  periods := array[day_key,day_key,minute_key]; caps := array[kind_cap,model_cap,rpm];
  for i in 1..3 loop
    if coalesce((select used from public.api_budget_usage where scope=scopes[i] and period=periods[i]),0) >= caps[i] then return false; end if;
  end loop;
  for i in 1..3 loop
    insert into public.api_budget_usage(scope,period,used) values(scopes[i],periods[i],1)
    on conflict(scope,period) do update set used=public.api_budget_usage.used+1;
  end loop;
  return true;
end $$;
revoke all on function public.reserve_gemini_call(text,text) from public, anon, authenticated;
grant execute on function public.reserve_gemini_call(text,text) to service_role;

create function public.reserve_tavily_call() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; month_cap integer; rpm integer;
  month_key text := to_char(now() at time zone 'UTC','YYYY-MM');
  minute_key text := to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
begin
  select value into strict cfg from public.system_config where key='budget';
  month_cap := (cfg->>'tavily_search_requests_per_month_max')::integer;
  rpm := (cfg->>'tavily_search_requests_per_minute_max')::integer;
  if month_cap is null or rpm is null or least(month_cap,rpm)<1 then return false; end if;
  perform pg_advisory_xact_lock(hashtext('content-ai-tavily-budget'));
  if coalesce((select used from public.api_budget_usage where scope='tavily:month' and period=month_key),0) >= month_cap
    or coalesce((select used from public.api_budget_usage where scope='tavily:rpm' and period=minute_key),0) >= rpm then return false; end if;
  insert into public.api_budget_usage(scope,period,used) values('tavily:month',month_key,1)
    on conflict(scope,period) do update set used=public.api_budget_usage.used+1;
  insert into public.api_budget_usage(scope,period,used) values('tavily:rpm',minute_key,1)
    on conflict(scope,period) do update set used=public.api_budget_usage.used+1;
  return true;
end $$;
revoke all on function public.reserve_tavily_call() from public, anon, authenticated;
grant execute on function public.reserve_tavily_call() to service_role;
