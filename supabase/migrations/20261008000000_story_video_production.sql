-- Durable video preparation. Disabled/unfunded wallets do not become production sources.
create table public.studio_video_wallets (
 id uuid primary key default gen_random_uuid(), label text not null check(char_length(label) between 1 and 80),
 quota_group text not null unique, unit text not null check(unit in ('usd_micro','credits','gpu_milliseconds')),
 free_tier text not null check(free_tier in ('recurring','permanent','trial','unknown')),
 enabled boolean not null default false, remaining_units bigint check(remaining_units between 0 and 9007199254740991),
 safety_units bigint not null default 0 check(safety_units between 0 and 9007199254740991),
 checked_at timestamptz, valid_until timestamptz, renews_at timestamptz,
 check(valid_until is null or valid_until>checked_at)
);
create table public.studio_video_wallet_access (
 wallet_id uuid not null references public.studio_video_wallets(id),
 workspace_id uuid not null references public.studio_workspaces(id), primary key(wallet_id,workspace_id)
);
create table public.studio_series_production (
 series_id uuid primary key, workspace_id uuid not null,
 profile jsonb not null check(jsonb_typeof(profile)='object'), profile_sha256 text not null check(profile_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), unique(series_id,profile_sha256),
 foreign key(series_id,workspace_id) references public.studio_series(id,workspace_id)
);
create table public.studio_video_compatibility (
 series_id uuid not null, profile_sha256 text not null, wallet_id uuid not null references public.studio_video_wallets(id),
 provider_id text not null, execution_sha256 text not null check(execution_sha256~'^[a-f0-9]{64}$'),
 kind text not null check(kind in ('dialogue','action','reaction')),
 evidence_path text not null check(char_length(evidence_path) between 1 and 1024),
 approved_by uuid not null, approved_at timestamptz not null default now(), revoked_at timestamptz,
 primary key(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind),
 foreign key(series_id,profile_sha256) references public.studio_series_production(series_id,profile_sha256)
);
create table public.studio_video_requests (
 id uuid primary key, workspace_id uuid not null references public.studio_workspaces(id), actor uuid not null,
 episode_id uuid not null references public.episodes(id), profile_sha256 text not null, plan jsonb not null,
 created_at timestamptz not null default now()
);
create table public.studio_video_jobs (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.studio_video_requests(id),
 workspace_id uuid not null references public.studio_workspaces(id), episode_id uuid not null references public.episodes(id),
 wallet_id uuid not null references public.studio_video_wallets(id), provider_id text not null,
 execution_sha256 text not null check(execution_sha256~'^[a-f0-9]{64}$'), shot_id text not null check(shot_id~'^[a-z0-9_-]{1,64}$'),
 input jsonb not null check(jsonb_typeof(input)='object'),
 reserved_units bigint not null check(reserved_units between 1 and 9007199254740991),
 state text not null default 'queued' check(state in ('queued','submitting','accepted','unknown','completed','rejected','cancelled')),
 external_id text, lease_token uuid, lease_until timestamptz,
 output_path text, output_sha256 text check(output_sha256~'^[a-f0-9]{64}$'),
 charged_units bigint check(charged_units between 0 and 9007199254740991), balance_reconciled boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(episode_id,shot_id),
 check(state<>'completed' or (output_path is not null and output_sha256 is not null)),
 check(not balance_reconciled or state in ('completed','rejected','cancelled'))
);
create unique index studio_video_external_id on public.studio_video_jobs(provider_id,external_id) where external_id is not null;
create index studio_video_pending on public.studio_video_jobs(wallet_id,state) where not balance_reconciled;

-- Immutable series identity. Revoking execution compatibility is separate from changing identity.
create function public.guard_series_production() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or new is distinct from old then raise check_violation using message='Series identity is immutable; create a reviewed version'; end if;
 return new;
end $$;
create trigger studio_series_production_immutable before update or delete on public.studio_series_production
 for each row execute function public.guard_series_production();

-- Entire chapter reservation is one transaction. Same physical wallet is locked across workspaces.
create function public.studio_reserve_video(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_video_requests; ep public.episodes; sid uuid; item jsonb; w public.studio_video_wallets;
 held numeric; required numeric; ids jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('video-request-'||p_request));
 select * into prior from public.studio_video_requests where id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.episode_id<>p_episode or prior.profile_sha256<>p_profile or prior.plan<>p_plan then raise insufficient_privilege; end if;
  select jsonb_agg(id order by shot_id) into ids from public.studio_video_jobs where request_id=p_request;
  return jsonb_build_object('code','reserved','job_ids',ids);
 end if;
 select * into strict ep from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 sid:=(ep.briefing#>>'{story_context,series_id}')::uuid;
 if ep.status<>'script' or sid is null or ep.script_hash is null or
   not exists(select 1 from public.studio_series_production where series_id=sid and workspace_id=p_workspace and profile_sha256=p_profile) then
  raise check_violation using message='Unprepared series or episode';
 end if;
 if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 100 then raise check_violation; end if;
 if (select count(distinct v->>'shot_id') from jsonb_array_elements(p_plan) v)<>jsonb_array_length(p_plan) then raise check_violation; end if;
 if exists(select 1 from public.studio_video_jobs where episode_id=p_episode) then return '{"code":"already_planned"}'; end if;
 -- Lock all wallets in stable order before testing any balance, preventing cross-wallet deadlocks.
 perform 1 from public.studio_video_wallets where id in (select (v->>'wallet_id')::uuid from jsonb_array_elements(p_plan) v) order by id for update;
 for item in select value from jsonb_array_elements(p_plan) loop
  select * into strict w from public.studio_video_wallets where id=(item->>'wallet_id')::uuid;
  if not exists(select 1 from public.studio_video_wallet_access where wallet_id=w.id and workspace_id=p_workspace) then raise insufficient_privilege; end if;
  if not w.enabled or w.free_tier not in ('recurring','permanent') or w.remaining_units is null or w.checked_at is null
   or w.checked_at>now() or w.checked_at<now()-interval '5 minutes' or w.valid_until is null or w.valid_until<=now() then
   return '{"code":"capacity_unavailable"}';
  end if;
  if (item->>'reserved_units')::numeric not between 1 and 9007199254740991 or
    (item->>'reserved_units')::numeric<>trunc((item->>'reserved_units')::numeric) or
    item->'input'->>'quality' is distinct from 'approved_master' or
    item->'input'#>>'{continuity,series_id}' is distinct from sid::text or
    item->'input'#>>'{continuity,profile_sha256}' is distinct from p_profile or
    item->'input'->>'id' is distinct from item->>'shot_id' or
    item->>'script_sha256' is distinct from ep.script_hash or
    coalesce((item->>'cash_cost')::numeric,-1)<>0 then raise check_violation; end if;
  if not exists(select 1 from public.studio_video_compatibility c where c.series_id=sid and c.profile_sha256=p_profile and c.wallet_id=w.id
   and c.provider_id=item->>'provider_id' and c.execution_sha256=item->>'execution_sha256' and c.kind=item->'input'->>'kind' and c.revoked_at is null) then
   return '{"code":"series_incompatible"}';
  end if;
  select coalesce(sum(greatest(reserved_units,coalesce(charged_units,0))),0) into held from public.studio_video_jobs where wallet_id=w.id and not balance_reconciled;
  select sum((v->>'reserved_units')::numeric) into required from jsonb_array_elements(p_plan) v where (v->>'wallet_id')::uuid=w.id;
  if held+required+w.safety_units>w.remaining_units then return '{"code":"insufficient_capacity"}'; end if;
 end loop;
 insert into public.studio_video_requests(id,workspace_id,actor,episode_id,profile_sha256,plan) values(p_request,p_workspace,p_actor,p_episode,p_profile,p_plan);
 for item in select value from jsonb_array_elements(p_plan) loop
  insert into public.studio_video_jobs(request_id,workspace_id,episode_id,wallet_id,provider_id,execution_sha256,shot_id,input,reserved_units)
   values(p_request,p_workspace,p_episode,(item->>'wallet_id')::uuid,item->>'provider_id',item->>'execution_sha256',item->>'shot_id',item->'input',(item->>'reserved_units')::bigint);
 end loop;
 select jsonb_agg(id order by shot_id) into ids from public.studio_video_jobs where request_id=p_request;
 return jsonb_build_object('code','reserved','job_ids',ids);
end $$;

-- Submission lease cannot be recycled after an uncertain external acceptance.
create function public.claim_video_job(p_job uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; token uuid:=gen_random_uuid(); w public.studio_video_wallets; r public.studio_video_requests; sid uuid;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 if j.state<>'queued' then return jsonb_build_object('code','reconcile','state',j.state,'external_id',j.external_id); end if;
 select * into strict w from public.studio_video_wallets where id=j.wallet_id for update;
 if not w.enabled or w.free_tier not in ('recurring','permanent') or w.remaining_units is null or w.checked_at is null or
  w.checked_at not between now()-interval '5 minutes' and now() or w.valid_until is null or w.valid_until<=now() then return '{"code":"paused"}'; end if;
 if w.remaining_units<w.safety_units+(select coalesce(sum(greatest(reserved_units,coalesce(charged_units,0))),0) from public.studio_video_jobs where wallet_id=w.id and not balance_reconciled) then
  return '{"code":"insufficient_capacity"}'; end if;
 select * into strict r from public.studio_video_requests where id=j.request_id;
 select (briefing#>>'{story_context,series_id}')::uuid into sid from public.episodes where id=j.episode_id and workspace_id=j.workspace_id and status='script'
  and script_hash=(select v->>'script_sha256' from jsonb_array_elements(r.plan) v where v->>'shot_id'=j.shot_id);
 if sid is null or not exists(select 1 from public.studio_video_compatibility c where c.series_id=sid and c.profile_sha256=r.profile_sha256
  and c.wallet_id=j.wallet_id and c.provider_id=j.provider_id and c.execution_sha256=j.execution_sha256 and c.kind=j.input->>'kind' and c.revoked_at is null) then
  return '{"code":"series_incompatible"}'; end if;
 update public.studio_video_jobs set state='submitting',lease_token=token,lease_until=now()+interval '2 minutes',updated_at=now() where id=j.id;
 return jsonb_build_object('code','claimed','token',token,'job',to_jsonb(j));
end $$;

create function public.finish_video_job(p_job uuid,p_token uuid,p_path text,p_hash text,p_charged bigint default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 if j.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if p_path is null or char_length(p_path) not between 1 and 1024 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_charged<0 or p_charged>9007199254740991 then raise check_violation; end if;
 if j.state='completed' and j.output_path=p_path and j.output_sha256=p_hash and j.charged_units is not distinct from p_charged then return '{"code":"saved"}'; end if;
 if j.state not in ('accepted','unknown') or j.external_id is null then raise check_violation; end if;
 -- Completion does not free money until a provider balance explicitly includes the charge.
 update public.studio_video_jobs set state='completed',output_path=p_path,output_sha256=p_hash,charged_units=p_charged,updated_at=now() where id=j.id;
 return '{"code":"saved"}';
end $$;

create function public.reconcile_video_wallet(p_wallet uuid,p_remaining bigint,p_checked timestamptz,p_valid timestamptz,p_included uuid[] default '{}') returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.studio_video_wallets;
begin
 select * into strict w from public.studio_video_wallets where id=p_wallet for update;
 if p_remaining is null or p_remaining not between 0 and 9007199254740991 or p_checked is null or p_valid is null or p_included is null or
  p_checked>now() or p_checked<now()-interval '5 minutes' or p_valid<=p_checked or p_checked<coalesce(w.checked_at,'-infinity'::timestamptz) then raise check_violation; end if;
 if exists(select 1 from unnest(p_included) i where not exists(select 1 from public.studio_video_jobs j
  where j.id=i and j.wallet_id=w.id and j.state='completed' and j.charged_units is not null)) then raise check_violation; end if;
 update public.studio_video_jobs set balance_reconciled=true,updated_at=now() where wallet_id=w.id and id=any(p_included);
 update public.studio_video_wallets set remaining_units=p_remaining,checked_at=p_checked,valid_until=p_valid where id=w.id;
end $$;
create function public.record_video_submission(p_job uuid,p_token uuid,p_outcome text,p_external text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 if j.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if p_outcome not in ('accepted','unknown','rejected') or (p_outcome='accepted' and coalesce(char_length(p_external),0) not between 1 and 512) then raise check_violation; end if;
 if p_outcome='rejected' and (j.external_id is not null or p_external is not null) then raise check_violation; end if;
 if j.state='completed' and p_outcome='accepted' and j.external_id=p_external then return '{"code":"saved"}'; end if;
 if j.state not in ('submitting','unknown') then
  if j.state=p_outcome and j.external_id is not distinct from p_external then return '{"code":"saved"}'; end if;
  raise check_violation;
 end if;
 -- Rejection must mean verified non-acceptance. Unknown holds the complete reservation.
 update public.studio_video_jobs set state=p_outcome,external_id=p_external,lease_until=null,
  balance_reconciled=(p_outcome='rejected'),charged_units=case when p_outcome='rejected' then 0 else null end,updated_at=now() where id=j.id;
 return '{"code":"saved"}';
end $$;

create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare wallets jsonb; profiles jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'label',w.label,'unit',w.unit,'free_tier',w.free_tier,'enabled',w.enabled,
  'remaining_units',w.remaining_units,'reserved_units',h.held,'safety_units',w.safety_units,'checked_at',w.checked_at,'valid_until',w.valid_until,'renews_at',w.renews_at,
  'available_units',case when w.enabled and w.remaining_units is not null and w.free_tier in ('recurring','permanent') and w.checked_at between now()-interval '5 minutes' and now() and w.valid_until>now()
   then greatest(0,w.remaining_units-h.held-w.safety_units) else null end) order by w.label),'[]') into wallets
 from public.studio_video_wallets w join public.studio_video_wallet_access a on a.wallet_id=w.id and a.workspace_id=p_workspace
 cross join lateral (select coalesce(sum(greatest(j.reserved_units,coalesce(j.charged_units,0))),0) held from public.studio_video_jobs j where j.wallet_id=w.id and not j.balance_reconciled) h;
 select coalesce(jsonb_agg(jsonb_build_object('series_id',p.series_id,'profile_sha256',p.profile_sha256,
  'compatible_wallets',(select coalesce(jsonb_agg(distinct c.wallet_id),'[]') from public.studio_video_compatibility c
    join public.studio_video_wallet_access a on a.wallet_id=c.wallet_id and a.workspace_id=p_workspace
    where c.series_id=p.series_id and c.profile_sha256=p.profile_sha256 and c.revoked_at is null))),'[]') into profiles
 from public.studio_series_production p where p.workspace_id=p_workspace;
 return jsonb_build_object('wallets',wallets,'series_profiles',profiles,'estimated_animated_seconds',null,'estimated_complete_chapters',null,
  'estimate_status','requires_shot_plan','checked_at',now());
end $$;

alter table public.studio_video_wallets enable row level security;
alter table public.studio_video_wallet_access enable row level security;
alter table public.studio_series_production enable row level security;
alter table public.studio_video_compatibility enable row level security;
alter table public.studio_video_requests enable row level security;
alter table public.studio_video_jobs enable row level security;
grant all on public.studio_video_wallets,public.studio_video_wallet_access,public.studio_series_production,public.studio_video_compatibility,public.studio_video_requests,public.studio_video_jobs to service_role;
revoke all on function public.guard_series_production(),public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),public.claim_video_job(uuid),public.record_video_submission(uuid,uuid,text,text),public.finish_video_job(uuid,uuid,text,text,bigint),public.reconcile_video_wallet(uuid,bigint,timestamptz,timestamptz,uuid[]),public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),public.claim_video_job(uuid),public.record_video_submission(uuid,uuid,text,text),public.finish_video_job(uuid,uuid,text,text,bigint),public.reconcile_video_wallet(uuid,bigint,timestamptz,timestamptz,uuid[]),public.studio_video_overview(uuid,uuid) to service_role;
