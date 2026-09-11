-- ADR-015: additive hardening; historical migrations remain unchanged.
alter table public.episodes add column failure_from_status text;

create or replace function public.validate_episode_transition()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare allowed text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'idea' then raise check_violation using message = 'Episode must start at idea'; end if;
    return new;
  end if;
  if old.status = new.status then return new; end if;
  allowed := case old.status
    when 'idea' then array['research','failed']
    when 'research' then array['script','failed']
    when 'script' then array['assets','failed']
    when 'assets' then array['rendered','failed']
    when 'rendered' then array['review','failed']
    when 'review' then array['published','script','assets','failed']
    when 'published' then array['analyze','failed']
    when 'analyze' then array['failed']
    when 'failed' then array[old.failure_from_status]
    else array[]::text[] end;
  if not coalesce(new.status = any(allowed), false) then
    raise check_violation using message = format('Illegal transition: %s -> %s', old.status, new.status);
  end if;
  if new.status = 'failed' then new.failure_from_status := old.status; end if;
  if old.status = 'failed' then new.failure_reason := null; new.failure_from_status := null; end if;
  if new.status in ('script','assets') and old.status = 'review' then
    new.approval_user := null;
    new.approval_date := null;
    new.render_url := null;
    new.render_progress := 0;
    new.metadata := (coalesce(new.metadata, '{}'::jsonb) - 'render_outputs' - 'render_dispatch')
      || jsonb_build_object('render_generation', gen_random_uuid());
    if new.status = 'script' then
      insert into public.job_events(episode_id,event_type,metadata)
      values(new.id,'approval_rejected',jsonb_build_object('reason','assets_regeneration',
        'previous_assets',coalesce((select jsonb_agg(to_jsonb(a)) from public.assets a where a.episode_id=new.id),'[]'::jsonb)));
      delete from public.assets where episode_id = new.id;
      new.tts_engine := null;
    end if;
  end if;
  return new;
end $$;
drop trigger episodes_validate_transition on public.episodes;
create trigger episodes_validate_transition before insert or update of status on public.episodes
for each row execute function public.validate_episode_transition();

-- Gate checks run even for same-state updates and inserts. Never trust only the UI.
create function public.enforce_episode_gate() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('published','analyze') and
    (nullif(trim(new.approval_user), '') is null or new.approval_date is null or new.render_url is null) then
    raise check_violation using message = 'Publication requires human approval and rendered media';
  end if;
  if new.status = 'failed' and nullif(trim(new.failure_reason), '') is null then
    raise check_violation using message = 'Failure requires a nonempty reason';
  end if;
  if new.status in ('script','assets','rendered','review','published','analyze') and
    (new.script_json is null or new.script_json #>> '{disclosures,contains_synthetic_media}' is distinct from 'true') then
    raise check_violation using message = 'Script requires synthetic disclosure';
  end if;
  if new.product_compliance->>'commercial_content' = 'true' and new.script_json is not null and
    (new.script_json #>> '{disclosures,commercial_content}' is distinct from 'true' or
     nullif(trim(new.script_json #>> '{disclosures,commercial_disclosure_text}'), '') is null) then
    raise check_violation using message = 'Affiliate episode requires commercial disclosure';
  end if;
  return new;
end $$;
create trigger episodes_z_gate before insert or update on public.episodes
for each row execute function public.enforce_episode_gate();

create function public.audit_episode_transition() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.job_events(episode_id,event_type,metadata)
    values(new.id,'state_transition',jsonb_build_object('from',old.status,'to',new.status));
  end if;
  return new;
end $$;
create trigger episodes_audit_transition after update of status on public.episodes
for each row execute function public.audit_episode_transition();

-- Preserve the existing SKIP LOCKED implementation, but serialize the daily cap.
alter function public.consume_next_idea() rename to consume_next_idea_unchecked;
revoke all on function public.consume_next_idea_unchecked() from public, anon, authenticated, service_role;
create function public.consume_next_idea() returns table(episode_id uuid,idea_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare cap integer;
begin
  perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
  select (value->>'max_episodes_per_day')::integer into strict cap from public.system_config where key='pipeline';
  if cap < 0 then raise check_violation using message='Invalid daily cap'; end if;
  if (select count(*) from public.episodes where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= cap then return; end if;
  return query select * from public.consume_next_idea_unchecked();
end $$;
revoke all on function public.consume_next_idea() from public, anon, authenticated;
grant execute on function public.consume_next_idea() to service_role;

-- Reservations happen BEFORE every provider attempt (including retries/failures).
create table public.api_budget_usage (
  scope text not null,
  period text not null,
  used integer not null check(used >= 0),
  primary key(scope,period)
);
alter table public.api_budget_usage enable row level security;
create function public.reserve_gemini_call(p_kind text, p_model text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; kind_cap integer; model_cap integer; rpm integer;
  day_key text := to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD');
  minute_key text := to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
  k text; caps integer[]; scopes text[]; periods text[]; i integer;
begin
  if p_kind not in ('grounding','text','tts','image') then raise check_violation using message='Invalid call kind'; end if;
  select value into strict cfg from public.system_config where key='budget';
  -- Image API is paid. A database flag must not silently enable billing.
  if p_kind='image' then return false; end if;
  k := case p_kind when 'text' then 'gemini_requests_per_day_max' else 'gemini_'||p_kind||'_requests_per_day_max' end;
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
    on conflict(scope,period) do update set used=api_budget_usage.used+1;
  end loop;
  return true;
end $$;
revoke all on function public.reserve_gemini_call(text,text) from public, anon, authenticated;
grant execute on function public.reserve_gemini_call(text,text) to service_role;

create table public.episode_leases (
  episode_id uuid primary key references public.episodes(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.episode_leases enable row level security;
revoke all on public.api_budget_usage, public.episode_leases from anon, authenticated;
grant all on public.api_budget_usage, public.episode_leases to service_role;
create function public.claim_episode(p_id uuid,p_token uuid) returns boolean
language sql security definer set search_path=public,pg_temp as $$
  with claimed as (
    insert into public.episode_leases values(p_id,p_token,now()+interval '180 seconds')
    on conflict(episode_id) do update set token=excluded.token,expires_at=excluded.expires_at
      where episode_leases.expires_at < now()
    returning 1
  ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_episode(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_episode(uuid,uuid) to service_role;

-- Public objects are readable without exposing table rows or allowing public writes.
insert into storage.buckets(id,name,public,file_size_limit)
values('assets','assets',true,52428800)
on conflict(id) do nothing;
