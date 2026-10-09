-- Billing observations are estimates. Neither a snapshot nor a grant enables a source.
alter table public.studio_video_jobs add column pause_code text check(pause_code in ('source_not_ready','source_rate_changed','paused','insufficient_capacity'));
create table public.studio_modal_wallet_config (
 wallet_id uuid primary key references public.studio_video_wallets(id),
 provider_workspace text not null unique check(provider_workspace~'^[a-z0-9_-]{1,64}$'),
 monthly_allowance_units bigint not null check(monthly_allowance_units between 1 and 1000000000),
 entitlement_evidence text not null check(char_length(entitlement_evidence) between 1 and 1024),
 entitlement_valid_until timestamptz not null,
 zero_spend_evidence text check(char_length(zero_spend_evidence) between 1 and 1024),
 zero_spend_valid_until timestamptz,
 adapter_ready boolean not null default false
);
create table public.studio_modal_observations (
 wallet_id uuid primary key references public.studio_modal_wallet_config(wallet_id),
 observation jsonb not null, checked_at timestamptz not null
);
alter table public.studio_modal_wallet_config enable row level security;
alter table public.studio_modal_observations enable row level security;
revoke all on public.studio_modal_wallet_config,public.studio_modal_observations from public,anon,authenticated;
grant all on public.studio_modal_wallet_config,public.studio_modal_observations to service_role;

create function public.observe_modal_wallet(p_wallet uuid,p_observation jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.studio_video_wallets; cfg public.studio_modal_wallet_config; checked timestamptz; expires timestamptz;
 renewal timestamptz; remaining bigint; metered bigint; billed bigint; prior timestamptz;
begin
 select * into strict w from public.studio_video_wallets where id=p_wallet for update;
 select * into strict cfg from public.studio_modal_wallet_config where wallet_id=p_wallet;
 checked:=(p_observation->>'checked_at')::timestamptz; expires:=(p_observation->>'valid_until')::timestamptz;
 renewal:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
 remaining:=(p_observation->>'remaining_units')::bigint; metered:=(p_observation->>'metered_units')::bigint; billed:=(p_observation->>'billed_units')::bigint;
 select checked_at into prior from public.studio_modal_observations where wallet_id=p_wallet;
 if w.unit<>'usd_micro' or w.free_tier<>'recurring' or w.quota_group is distinct from 'modal:'||cfg.provider_workspace or
  cfg.entitlement_valid_until<=now() or p_observation->>'provider_workspace' is distinct from cfg.provider_workspace or
  p_observation->>'provider_id' is distinct from 'modal-wan-s2v-h100-v1' or p_observation->>'unit' is distinct from 'usd_micro' or
  p_observation->>'execution_sha256' is null or p_observation->>'execution_sha256'!~'^[a-f0-9]{64}$' or
  p_observation->>'balance_kind' is distinct from 'conservative_monthly_estimate' or p_observation->>'billing_may_lag' is distinct from 'true' or
  p_observation->>'estimate' is distinct from 'true' or p_observation->>'cash_cost' is distinct from '0' or
  p_observation->>'requires_verified_zero_spend_limit' is distinct from 'true' or
  p_observation->>'infrastructure_retry_ceiling_guaranteed' is distinct from 'false' or
  checked is null or checked>now()+interval '5 seconds' or checked<now()-interval '5 minutes' or checked<coalesce(prior,'-infinity') or
  expires is null or expires<=now() or expires>checked+interval '5 minutes' or expires>renewal or
  p_observation->>'cycle' is distinct from to_char(now() at time zone 'UTC','YYYY-MM') or
  (p_observation->>'renews_at')::timestamptz is distinct from renewal or
  remaining is null or metered is null or billed is null or metered<0 or billed<0 or
  remaining is distinct from greatest(0,cfg.monthly_allowance_units-metered) or
  coalesce((p_observation->>'per_shot_units')::bigint,0) not between 1 and 1000000000 or
  p_observation->>'native_seconds' is distinct from '3.9375' or p_observation->>'output_seconds' is distinct from '3.95' then raise check_violation; end if;
 -- Keep all unreconciled holds. An account-wide summary cannot prove a particular job charge.
 insert into public.studio_modal_observations values(p_wallet,p_observation,checked)
 on conflict(wallet_id) do update set observation=excluded.observation,checked_at=excluded.checked_at;
 update public.studio_video_wallets set remaining_units=remaining,checked_at=least(checked,now()),valid_until=expires,renews_at=renewal where id=p_wallet;
 return jsonb_build_object('code','observed','remaining_units',remaining,'balance_kind','conservative_monthly_estimate','enabled',w.enabled);
end $$;

create function public.studio_modal_eligible(p_wallet uuid,p_execution text) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.studio_modal_wallet_config c join public.studio_modal_observations o using(wallet_id)
 join public.studio_video_wallets w on w.id=c.wallet_id
 where c.wallet_id=p_wallet and c.adapter_ready and c.entitlement_valid_until>now() and c.zero_spend_evidence is not null and c.zero_spend_valid_until>now()
 and w.enabled and w.unit='usd_micro' and w.free_tier='recurring' and w.quota_group='modal:'||c.provider_workspace
 and o.checked_at between now()-interval '5 minutes' and now()+interval '5 seconds' and (o.observation->>'valid_until')::timestamptz>now()
 and o.observation->>'execution_sha256'=p_execution and o.observation->>'billed_units'='0');
$$;

alter function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb) rename to studio_reserve_video_before_billing;
revoke all on function public.studio_reserve_video_before_billing(uuid,uuid,uuid,uuid,text,jsonb) from service_role;
create function public.studio_reserve_video(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; observation jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 perform 1 from public.studio_video_wallets where id in (select (v->>'wallet_id')::uuid from jsonb_array_elements(p_plan) v) order by id for update;
 -- Account policy/rates must also pass when a browser supplies a syntactically valid plan.
 for item in select value from jsonb_array_elements(p_plan) loop
  if item->>'provider_id'='modal-wan-s2v-h100-v1' then
   if not public.studio_modal_eligible((item->>'wallet_id')::uuid,item->>'execution_sha256') then return '{"code":"source_not_ready"}'; end if;
   select o.observation into strict observation from public.studio_modal_observations o where wallet_id=(item->>'wallet_id')::uuid;
   if item->>'reserved_units' is distinct from observation->>'per_shot_units' then raise check_violation; end if;
  end if;
 end loop;
 return public.studio_reserve_video_before_billing(p_workspace,p_actor,p_request,p_episode,p_profile,p_plan);
end $$;
alter function public.claim_video_job(uuid) rename to claim_video_job_before_billing;
revoke all on function public.claim_video_job_before_billing(uuid) from service_role;
create function public.claim_video_job(p_job uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; outcome jsonb;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 perform 1 from public.studio_video_wallets where id=j.wallet_id for update;
 if j.state='queued' and j.provider_id='modal-wan-s2v-h100-v1' then
  if not public.studio_modal_eligible(j.wallet_id,j.execution_sha256) then outcome:='{"code":"source_not_ready"}';
  elsif j.reserved_units<(select (observation->>'per_shot_units')::bigint from public.studio_modal_observations where wallet_id=j.wallet_id) then outcome:='{"code":"source_rate_changed"}'; end if;
 end if;
 outcome:=coalesce(outcome,public.claim_video_job_before_billing(p_job));
 if outcome->>'code' in ('source_not_ready','source_rate_changed','paused','insufficient_capacity','claimed') then
  update public.studio_video_jobs set pause_code=case when outcome->>'code'='claimed' then null else outcome->>'code' end where id=p_job;
 end if;
 return outcome;
end $$;
alter function public.begin_video_worker(uuid,text,text) rename to begin_video_worker_before_billing;
revoke all on function public.begin_video_worker_before_billing(uuid,text,text) from service_role;
create function public.begin_video_worker(p_job uuid,p_capability text,p_external text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; outcome jsonb;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 perform 1 from public.studio_video_wallets where id=j.wallet_id for update;
 -- An already started worker still uses the original idempotent gate for recovery.
 if j.provider_id='modal-wan-s2v-h100-v1' and not exists(select 1 from public.studio_video_worker_tickets where job_id=p_job and started_at is not null)
  and not public.studio_modal_eligible(j.wallet_id,j.execution_sha256) then outcome:='{"code":"source_not_ready"}'; end if;
 if j.provider_id='modal-wan-s2v-h100-v1' and not exists(select 1 from public.studio_video_worker_tickets where job_id=p_job and started_at is not null)
  and j.reserved_units<(select (observation->>'per_shot_units')::bigint from public.studio_modal_observations where wallet_id=j.wallet_id) then outcome:='{"code":"source_rate_changed"}'; end if;
 outcome:=coalesce(outcome,public.begin_video_worker_before_billing(p_job,p_capability,p_external));
 if outcome->>'code' in ('source_not_ready','source_rate_changed','paused','insufficient_capacity','started') then
  update public.studio_video_jobs set pause_code=case when outcome->>'code'='started' then null else outcome->>'code' end where id=p_job;
 end if;
 return outcome;
end $$;

-- Member-facing evidence keeps estimates separate from available capacity.
alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_billing;
revoke all on function public.studio_video_overview_before_billing(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; wallets jsonb;
begin
 result:=public.studio_video_overview_before_billing(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||case when c.wallet_id is null then '{}'::jsonb else jsonb_build_object(
  'balance_kind','conservative_monthly_estimate','billing_may_lag',true,
  'metered_units',o.observation->'metered_units','per_shot_units',o.observation->'per_shot_units',
  'source_ready',coalesce((v->>'enabled')::boolean and public.studio_modal_eligible(c.wallet_id,o.observation->>'execution_sha256'),false),
  'available_units',case when public.studio_modal_eligible(c.wallet_id,o.observation->>'execution_sha256') then v->'available_units' else 'null'::jsonb end) end order by v->>'label'),'[]') into wallets
 from jsonb_array_elements(result->'wallets') v left join public.studio_modal_wallet_config c on c.wallet_id=(v->>'id')::uuid
 left join public.studio_modal_observations o on o.wallet_id=c.wallet_id;
 return jsonb_set(result,'{wallets}',wallets);
end $$;
revoke all on function public.observe_modal_wallet(uuid,jsonb),public.studio_modal_eligible(uuid,text),public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),
 public.claim_video_job(uuid),public.begin_video_worker(uuid,text,text),public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.observe_modal_wallet(uuid,jsonb),public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),
 public.claim_video_job(uuid),public.begin_video_worker(uuid,text,text),public.studio_video_overview(uuid,uuid) to service_role;
