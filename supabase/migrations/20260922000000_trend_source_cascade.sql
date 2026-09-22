-- ADR-034: fontes complementares de descoberta de produtos. Resultados entram
-- apenas como candidatos em idea_queue; nunca como produto afiliado confirmado.

insert into public.system_config (key, value) values
  ('trend_sources', '{
    "socialcrawl": {
      "enabled": true,
      "region": "BR",
      "max_results": 5,
      "max_requests_per_day": 20
    },
    "trends_mcp": {
      "enabled": true,
      "max_results": 5,
      "max_requests_per_day": 3
    }
  }'::jsonb)
on conflict (key) do nothing;

create or replace function public.reserve_trend_source_call(p_source text) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg jsonb;
  source_cfg jsonb;
  daily_cap integer;
  day_key text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  usage_scope text;
begin
  if p_source not in ('socialcrawl', 'trends_mcp') then
    raise check_violation using message = 'Invalid trend source';
  end if;

  select value into strict cfg from public.system_config where key = 'trend_sources';
  source_cfg := cfg -> p_source;
  daily_cap := (source_cfg ->> 'max_requests_per_day')::integer;
  if coalesce((source_cfg ->> 'enabled')::boolean, false) is not true
    or daily_cap is null or daily_cap < 1 then
    return false;
  end if;

  usage_scope := 'trend_source:' || p_source;
  perform pg_advisory_xact_lock(hashtext('content-ai-' || usage_scope || '-budget'));
  if coalesce((
    select used from public.api_budget_usage
    where scope = usage_scope and period = day_key
  ), 0) >= daily_cap then
    return false;
  end if;

  insert into public.api_budget_usage(scope, period, used)
  values (usage_scope, day_key, 1)
  on conflict(scope, period) do update
    set used = public.api_budget_usage.used + 1;
  return true;
end;
$$;

revoke all on function public.reserve_trend_source_call(text) from public, anon, authenticated;
grant execute on function public.reserve_trend_source_call(text) to service_role;
