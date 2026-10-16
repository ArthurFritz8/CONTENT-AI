-- Separate recurring Puter pool; never mixed with Auray, Modal or purchased credit.
create table public.studio_puter_accounts(
 id uuid primary key default gen_random_uuid(),account_sha256 text not null unique check(account_sha256~'^[a-f0-9]{64}$'),
 secret_id uuid not null,observation jsonb not null default '{}',observed_at timestamptz,last_code text,
 lease_token uuid,lease_until timestamptz,last_sync_requested_at timestamptz,created_at timestamptz not null default now(),
 check((lease_token is null)=(lease_until is null))
);
create table public.studio_puter_access(
 account_id uuid not null references public.studio_puter_accounts(id),workspace_id uuid not null references public.studio_workspaces(id),
 created_at timestamptz not null default now(),primary key(account_id,workspace_id)
);
alter table public.studio_puter_accounts enable row level security;
alter table public.studio_puter_access enable row level security;
revoke all on public.studio_puter_accounts,public.studio_puter_access from public,anon,authenticated;
grant all on public.studio_puter_accounts,public.studio_puter_access to service_role;

create function public.valid_puter_observation(p jsonb) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['provider','account_sha256','checked_at','remaining_credits','monthly_allowance','storage_free_bytes','unit','financially_eligible','contract_sha256','budget_basis','provider_quote','blockers']) or
  (select count(*) from jsonb_object_keys(p))<>12 or p->>'provider' is distinct from 'puter' or p->>'unit' is distinct from 'credits' or
  coalesce(p->>'account_sha256','')!~'^[a-f0-9]{64}$' or p->>'budget_basis' is distinct from 'empirical_conservative_estimate' or p->>'provider_quote' is distinct from 'false' or
  jsonb_typeof(p->'financially_eligible') is distinct from 'boolean' or jsonb_typeof(p->'blockers') is distinct from 'array' or jsonb_array_length(p->'blockers')>12 or
  exists(select 1 from jsonb_array_elements_text(p->'blockers') b where b!~'^[a-z_]{1,80}$') then return false;end if;
 if p->>'remaining_credits' is not null and (p->>'remaining_credits')::numeric<0 or
  p->>'monthly_allowance' is not null and p->>'monthly_allowance'<>'1000' or
  p->>'storage_free_bytes' is not null and (p->>'storage_free_bytes')::bigint<0 or
  p->>'contract_sha256' is not null and p->>'contract_sha256'!~'^[a-f0-9]{64}$' or p->>'checked_at' is null then return false;end if;
 if p->>'financially_eligible'='true' and (p->>'monthly_allowance' is distinct from '1000' or
  p->>'contract_sha256' is distinct from 'af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364' or
  coalesce((p->>'remaining_credits')::numeric,-1) not between 0 and 1000 or coalesce((p->>'storage_free_bytes')::bigint,0)<8388608 or
  exists(select 1 from jsonb_array_elements_text(p->'blockers') b where b<>'insufficient_free_credits')) then return false;end if;
 return true;
exception when others then return false;
end $$;

create function public.studio_puter_connect(p_workspace uuid,p_actor uuid,p_token text,p_observation jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.studio_puter_accounts;secret uuid;stamp timestamptz;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if not public.valid_puter_observation(p_observation) or p_observation->>'financially_eligible' is distinct from 'true' or
  p_token is null or char_length(p_token) not between 16 and 8192 or p_token~'[[:space:]]' then raise check_violation;end if;
 stamp:=(p_observation->>'checked_at')::timestamptz;
 if stamp not between now()-interval '2 minutes' and now()+interval '5 seconds' then raise check_violation;end if;
 perform pg_advisory_xact_lock(hashtext('puter-account-'||(p_observation->>'account_sha256')));
 select * into a from public.studio_puter_accounts where account_sha256=p_observation->>'account_sha256' for update;
 if a.lease_until>now() then return '{"code":"account_busy"}';end if;
 if a.id is null then
  execute 'select vault.create_secret($1)' into secret using p_token;
  insert into public.studio_puter_accounts(account_sha256,secret_id,observation,observed_at) values(p_observation->>'account_sha256',secret,p_observation,stamp) returning * into a;
 else
  execute 'select vault.update_secret($1,$2)' using a.secret_id,p_token;
  update public.studio_puter_accounts set observation=p_observation,observed_at=stamp,last_code=null where id=a.id;
 end if;
 insert into public.studio_puter_access(account_id,workspace_id) values(a.id,p_workspace) on conflict do nothing;
 return jsonb_build_object('code','connected','account_id',a.id);
end $$;

create function public.claim_puter_inspection(p_account uuid,p_token uuid,p_workspace uuid default null,p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.studio_puter_accounts;credential text;
begin
 if p_workspace is not null or p_actor is not null then
  perform public.studio_assert_member(p_workspace,p_actor);
  if not exists(select 1 from public.studio_puter_access where workspace_id=p_workspace and account_id=p_account) then raise insufficient_privilege;end if;
 end if;
 if p_token is null then raise check_violation;end if;
 select * into strict a from public.studio_puter_accounts where id=p_account for update;
 if a.lease_until>now() then return '{"code":"account_busy"}';end if;
 if a.last_sync_requested_at>now()-interval '2 minutes' then return '{"code":"cooldown"}';end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into credential using a.secret_id;
 if credential is null then return '{"code":"connection_required"}';end if;
 update public.studio_puter_accounts set lease_token=p_token,lease_until=now()+interval '2 minutes',last_sync_requested_at=now() where id=a.id;
 return jsonb_build_object('code','claimed','credential',credential,'account_sha256',a.account_sha256);
end $$;

create function public.finish_puter_inspection(p_account uuid,p_token uuid,p_observation jsonb,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.studio_puter_accounts;stamp timestamptz;
begin
 select * into strict a from public.studio_puter_accounts where id=p_account for update;
 if a.lease_token is distinct from p_token or a.lease_until<=now() then raise insufficient_privilege;end if;
 if p_error is not null then
  if p_error!~'^[a-z_]{1,80}$' then raise check_violation;end if;
  update public.studio_puter_accounts set last_code=p_error,lease_token=null,lease_until=null where id=a.id;return;
 end if;
 if not public.valid_puter_observation(p_observation) or p_observation->>'account_sha256' is distinct from a.account_sha256 then raise check_violation;end if;
 stamp:=(p_observation->>'checked_at')::timestamptz;
 if stamp not between now()-interval '2 minutes' and now()+interval '5 seconds' then raise check_violation;end if;
 update public.studio_puter_accounts set observation=p_observation,observed_at=stamp,last_code=null,lease_token=null,lease_until=null where id=a.id;
end $$;

create function public.studio_puter_view(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare accounts jsonb;enabled boolean;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 enabled:=coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label','Puter','provider','puter','checked_at',a.observed_at,
   'remaining_credits',a.observation->'remaining_credits','monthly_allowance',a.observation->'monthly_allowance','unit','credits',
   'storage_free_bytes',a.observation->'storage_free_bytes','balance_fresh',coalesce(a.observed_at>now()-interval '2 minutes' and a.last_code is null,false),
   'financially_eligible',a.observation->'financially_eligible','blockers',coalesce(a.observation->'blockers','[]'),
   'busy',coalesce(a.lease_until>now(),false),'sync_failed',a.last_code is not null,'last_code',a.last_code,
   'budget_basis','empirical_conservative_estimate','provider_quote',false,'credits_per_shot',330,'credits_per_chapter',990,
   'estimated_chapters',case when a.observed_at>now()-interval '2 minutes' and a.last_code is null and a.observation->>'financially_eligible'='true' then floor((a.observation->>'remaining_credits')::numeric/990) end,
   'estimated_seconds',case when a.observed_at>now()-interval '2 minutes' and a.last_code is null and a.observation->>'financially_eligible'='true' then floor((a.observation->>'remaining_credits')::numeric/330)*5 end
 ) order by a.created_at),'[]') into accounts from public.studio_puter_accounts a join public.studio_puter_access x on x.account_id=a.id where x.workspace_id=p_workspace;
 return jsonb_build_object('enabled',enabled,'accounts',accounts);
end $$;

create function public.puter_monitor_accounts() returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(id),'[]') from (select id from public.studio_puter_accounts where coalesce(lease_until<=now(),true) and
  coalesce(last_sync_requested_at<=now()-interval '20 minutes',true) order by observed_at nulls first,created_at limit 3) q
$$;

revoke all on function public.valid_puter_observation(jsonb),public.studio_puter_connect(uuid,uuid,text,jsonb),public.claim_puter_inspection(uuid,uuid,uuid,uuid),public.finish_puter_inspection(uuid,uuid,jsonb,text),public.studio_puter_view(uuid,uuid),public.puter_monitor_accounts() from public,anon,authenticated;
grant execute on function public.valid_puter_observation(jsonb),public.studio_puter_connect(uuid,uuid,text,jsonb),public.claim_puter_inspection(uuid,uuid,uuid,uuid),public.finish_puter_inspection(uuid,uuid,jsonb,text),public.studio_puter_view(uuid,uuid),public.puter_monitor_accounts() to service_role;
