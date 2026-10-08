-- A narrowly scoped worker capability; never send a service-role credential to Modal.
create table public.studio_video_worker_tickets (
 job_id uuid primary key references public.studio_video_jobs(id), lease_token uuid not null,
 capability_sha256 text not null unique check(capability_sha256~'^[a-f0-9]{64}$'),
 bucket text not null default 'studio-private' check(bucket='studio-private'),
 output_prefix text not null unique, expires_at timestamptz not null,
 started_at timestamptz, finished_at timestamptz, failure_code text,
 report jsonb, manifests jsonb, created_at timestamptz not null default now()
);
alter table public.studio_video_worker_tickets enable row level security;
grant all on public.studio_video_worker_tickets to service_role;

-- A queued quote/input cannot change between runner preflight, claim and GPU start.
create function public.guard_video_job_contract() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if row(new.id,new.request_id,new.workspace_id,new.episode_id,new.wallet_id,new.provider_id,new.execution_sha256,new.shot_id,new.input,new.reserved_units,new.created_at)
  is distinct from row(old.id,old.request_id,old.workspace_id,old.episode_id,old.wallet_id,old.provider_id,old.execution_sha256,old.shot_id,old.input,old.reserved_units,old.created_at) then
  raise check_violation using message='Reserved video contract is immutable';
 end if;
 return new;
end $$;
create trigger studio_video_job_contract_immutable before update on public.studio_video_jobs
 for each row execute function public.guard_video_job_contract();
revoke all on function public.guard_video_job_contract() from public,anon,authenticated;

create function public.register_video_worker(p_job uuid,p_lease uuid,p_capability text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; t public.studio_video_worker_tickets; prefix text;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 if j.lease_token is distinct from p_lease or j.state<>'submitting' or j.lease_until<=now() then raise insufficient_privilege; end if;
 if p_capability is null or p_capability!~'^[a-f0-9]{64}$' then raise check_violation; end if;
 select * into t from public.studio_video_worker_tickets where job_id=j.id;
 if found then
  if t.lease_token<>p_lease or t.capability_sha256<>p_capability then raise insufficient_privilege; end if;
 else
  prefix:=j.workspace_id||'/videos/'||j.episode_id||'/'||j.id||'/'||p_lease;
  insert into public.studio_video_worker_tickets(job_id,lease_token,capability_sha256,output_prefix,expires_at)
   values(j.id,p_lease,p_capability,prefix,now()+interval '2 hours') returning * into t;
 end if;
 return jsonb_build_object('bucket',t.bucket,'prefix',t.output_prefix,'expires_at',t.expires_at);
end $$;

-- A repeated/preempted CPU relay may recover completed storage, but cannot launch another GPU.
create function public.begin_video_worker(p_job uuid,p_capability text,p_external text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; t public.studio_video_worker_tickets; w public.studio_video_wallets;
 r public.studio_video_requests; sid uuid;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 select * into strict t from public.studio_video_worker_tickets where job_id=j.id for update;
 if t.capability_sha256 is distinct from p_capability or t.lease_token is distinct from j.lease_token or t.expires_at<=now() then raise insufficient_privilege; end if;
 if p_external is null or p_external!~'^fc-[A-Za-z0-9_-]{1,100}$' then raise check_violation; end if;
 if j.external_id is not null and j.external_id<>p_external then raise insufficient_privilege; end if;
 if t.started_at is not null then return jsonb_build_object('code','already_started','state',j.state); end if;
 if j.state not in ('submitting','accepted','unknown') then raise check_violation; end if;
 select * into strict w from public.studio_video_wallets where id=j.wallet_id for update;
 if not w.enabled or w.free_tier not in ('recurring','permanent') or w.remaining_units is null or w.checked_at is null or
  w.checked_at not between now()-interval '5 minutes' and now() or w.valid_until is null or w.valid_until<=now() then return '{"code":"paused"}'; end if;
 if w.remaining_units<w.safety_units+(select coalesce(sum(greatest(reserved_units,coalesce(charged_units,0))),0) from public.studio_video_jobs where wallet_id=w.id and not balance_reconciled) then return '{"code":"insufficient_capacity"}'; end if;
 select * into strict r from public.studio_video_requests where id=j.request_id;
 select (briefing#>>'{story_context,series_id}')::uuid into sid from public.episodes where id=j.episode_id and workspace_id=j.workspace_id and status='script'
  and script_hash=(select v->>'script_sha256' from jsonb_array_elements(r.plan) v where v->>'shot_id'=j.shot_id);
 if sid is null or not exists(select 1 from public.studio_video_compatibility c where c.series_id=sid and c.profile_sha256=r.profile_sha256
  and c.wallet_id=j.wallet_id and c.provider_id=j.provider_id and c.execution_sha256=j.execution_sha256 and c.kind=j.input->>'kind' and c.revoked_at is null) then return '{"code":"series_incompatible"}'; end if;
 update public.studio_video_worker_tickets set started_at=now() where job_id=j.id;
 update public.studio_video_jobs set state='accepted',external_id=p_external,lease_until=null,updated_at=now() where id=j.id;
 return '{"code":"started"}';
end $$;

create function public.complete_video_worker(p_job uuid,p_capability text,p_report jsonb,p_manifests jsonb,p_recovery boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; t public.studio_video_worker_tickets;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 select * into strict t from public.studio_video_worker_tickets where job_id=j.id for update;
 if t.capability_sha256 is distinct from p_capability or t.lease_token is distinct from j.lease_token or (t.expires_at<=now() and not coalesce(p_recovery,false)) then raise insufficient_privilege; end if;
 if t.started_at is null or p_report is null or jsonb_typeof(p_report)<>'object' or p_manifests is null or jsonb_typeof(p_manifests)<>'object' then raise check_violation; end if;
 if p_report->>'human_review_required' is distinct from 'true' or p_report->>'lip_sync_validated' is distinct from 'false' or
  p_report->>'execution_sha256' is distinct from j.execution_sha256 or
  p_report->>'reference_sha256' is distinct from j.input->>'reference_sha256' or
  p_report->>'input_audio_sha256' is distinct from j.input->>'audio_sha256' or
  p_manifests#>>'{fluid,sha256}' is null or p_manifests#>>'{fluid,sha256}'!~'^[a-f0-9]{64}$' or
  coalesce((p_manifests#>>'{fluid,size}')::bigint,0) not between 1 and 31457280 then raise check_violation; end if;
 if t.finished_at is not null then
  if t.report<>p_report or t.manifests<>p_manifests then raise check_violation; end if;
  return '{"code":"saved"}';
 end if;
 perform public.finish_video_job(j.id,t.lease_token,t.output_prefix||'/fluid.mp4',p_manifests#>>'{fluid,sha256}',null);
 update public.studio_video_worker_tickets set finished_at=now(),report=p_report,manifests=p_manifests,failure_code=null where job_id=j.id;
 -- Only storage is complete. Do not mark an episode ready, approved or publish it.
 return '{"code":"saved"}';
end $$;

create function public.fail_video_worker(p_job uuid,p_capability text,p_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs; t public.studio_video_worker_tickets;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 select * into strict t from public.studio_video_worker_tickets where job_id=j.id for update;
 if t.capability_sha256 is distinct from p_capability or t.lease_token is distinct from j.lease_token or t.expires_at<=now() then raise insufficient_privilege; end if;
 if p_code is null or p_code!~'^[A-Z_]{1,64}$' then raise check_violation; end if;
 if j.state='completed' then return '{"code":"saved"}'; end if;
 if j.state not in ('submitting','accepted','unknown') then raise check_violation; end if;
 update public.studio_video_jobs set state='unknown',updated_at=now() where id=j.id;
 update public.studio_video_worker_tickets set failure_code=p_code where job_id=j.id;
 return '{"code":"reconcile"}';
end $$;

revoke all on function public.register_video_worker(uuid,uuid,text),public.begin_video_worker(uuid,text,text),public.complete_video_worker(uuid,text,jsonb,jsonb,boolean),public.fail_video_worker(uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_video_worker(uuid,uuid,text),public.begin_video_worker(uuid,text,text),public.complete_video_worker(uuid,text,jsonb,jsonb,boolean),public.fail_video_worker(uuid,text,text) to service_role;

-- A late uncertain submit response must never erase an ID already learned by the callback.
create or replace function public.record_video_submission(p_job uuid,p_token uuid,p_outcome text,p_external text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_video_jobs;
begin
 select * into strict j from public.studio_video_jobs where id=p_job for update;
 if j.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if p_outcome not in ('accepted','unknown','rejected') or (p_outcome='accepted' and coalesce(char_length(p_external),0) not between 1 and 512) then raise check_violation; end if;
 if j.external_id is not null and p_external is not null and j.external_id<>p_external then raise check_violation; end if;
 if p_outcome='rejected' and (j.external_id is not null or p_external is not null) then raise check_violation; end if;
 if j.state='completed' and p_outcome='accepted' and j.external_id=p_external then return '{"code":"saved"}'; end if;
 if j.state not in ('submitting','unknown') then
  if j.state=p_outcome and j.external_id is not distinct from p_external then return '{"code":"saved"}'; end if;
  -- An acknowledged acceptance is stronger evidence than a late missing submit response.
  if j.state in ('accepted','completed') and p_outcome='unknown' and p_external is null and j.external_id is not null then return '{"code":"saved"}'; end if;
  raise check_violation;
 end if;
 update public.studio_video_jobs set state=p_outcome,external_id=coalesce(j.external_id,p_external),lease_until=null,
  balance_reconciled=(p_outcome='rejected'),charged_units=case when p_outcome='rejected' then 0 else null end,updated_at=now() where id=j.id;
 return '{"code":"saved"}';
end $$;
