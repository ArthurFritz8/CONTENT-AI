-- ADR-030: personagem/apresentador fixo opt-in, com orçamento e custo real separados
-- do caminho de imagem genérico vetado pelo ADR-015. O bloqueio de 'image' em
-- reserve_gemini_call e em getGeminiBudgetRemaining permanece intocado.

create or replace function public.reserve_gemini_call(p_kind text, p_model text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb; kind_cap integer; model_cap integer; rpm integer;
  day_key text := to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD');
  minute_key text := to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
  k text; caps integer[]; scopes text[]; periods text[]; i integer;
begin
  if p_kind not in ('grounding','research','text','tts','image','spokesmodel') then raise check_violation using message='Invalid call kind'; end if;
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

update public.system_config set value = value || jsonb_build_object(
  'gemini_spokesmodel_requests_per_day_max', 20,
  'gemini_spokesmodel_cost_usd_estimate', 0.04
) where key = 'budget';

update public.system_config
  set value = jsonb_set(value, '{gemini_models,gemini-2.5-flash-image}', '{"rpd": 20, "rpm": 5}'::jsonb)
  where key = 'budget';

-- Desativado por padrão: exige ativação explícita do operador + faturamento Gemini confirmado.
insert into public.system_config (key, value) values
  ('spokesmodel', '{
    "enabled": false,
    "character_description": null,
    "reference_image_url": null,
    "max_scenes_per_episode": 1
  }'::jsonb)
on conflict (key) do nothing;
