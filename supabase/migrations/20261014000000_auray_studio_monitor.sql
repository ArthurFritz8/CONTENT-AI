-- Auray is a monitored candidate, never a production wallet in this revision.
create table public.studio_auray_config (
 wallet_id uuid primary key references public.studio_video_wallets(id),
 account_sha256 text not null unique check(account_sha256~'^[a-f0-9]{64}$'),
 observation jsonb, sync_error boolean not null default false,
 lease_token uuid, lease_until timestamptz
);
create table public.studio_auray_jobs (
 id uuid primary key default gen_random_uuid(), wallet_id uuid not null references public.studio_auray_config(wallet_id),
 workspace_id uuid not null references public.studio_workspaces(id),
 request_key text not null check(request_key~'^[a-f0-9]{64}$'),
 external_id text not null check(external_id='video_'||request_key),
 label text not null check(char_length(label) between 1 and 100),
 kind text not null check(kind in ('action','reaction','native_dialogue_probe')),
 aspect_ratio text not null check(aspect_ratio in ('9:16','16:9')),
 expected_sha256 text check(expected_sha256~'^[a-f0-9]{64}$'),
 status text not null default 'unknown' check(status in ('unknown','queued','running','succeeded','failed','cancelled')),
 settled boolean not null default false, charged_credits int not null default 0 check(charged_credits between 0 and 5),
 ready boolean not null default false, output_sha256 text check(output_sha256~'^[a-f0-9]{64}$'),
 bytes int check(bytes between 1 and 67108864), path text,
 observed_at timestamptz, created_at timestamptz not null default now(),
 unique(wallet_id,external_id),
 check(not ready or (status='succeeded' and settled and output_sha256 is not null and path is not null and bytes is not null))
);
alter table public.studio_auray_config enable row level security;
alter table public.studio_auray_jobs enable row level security;
revoke all on public.studio_auray_config,public.studio_auray_jobs from public,anon,authenticated;
grant all on public.studio_auray_config,public.studio_auray_jobs to service_role;

create function public.guard_auray_candidate_wallet() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.studio_auray_config where wallet_id=new.id) and
  (new.enabled or new.unit<>'credits' or new.free_tier<>'recurring' or new.quota_group<>old.quota_group) then
  raise check_violation using message='Auray monitoring does not authorize production';
 end if;
 return new;
end $$;
create trigger auray_candidate_wallet before update on public.studio_video_wallets for each row execute function public.guard_auray_candidate_wallet();

-- Operator-only import of jobs already submitted by the durable audition executor.
-- No prompt, token, signed URL or new submission enters the panel API.
create function public.register_auray_monitor(p_workspace uuid,p_account text,p_jobs jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare wid uuid; item jsonb; prior public.studio_auray_jobs;
begin
 if p_account is null or p_account!~'^[a-f0-9]{64}$' or jsonb_typeof(p_jobs) is distinct from 'array' or jsonb_array_length(p_jobs)>50 then raise check_violation; end if;
 perform 1 from public.studio_workspaces where id=p_workspace;
 if not found then raise no_data_found; end if;
 perform pg_advisory_xact_lock(hashtext('auray-monitor-'||p_account));
 select wallet_id into wid from public.studio_auray_config where account_sha256=p_account;
 if wid is null then
  insert into public.studio_video_wallets(label,quota_group,unit,free_tier,enabled) values('Auray · em avaliação','auray:'||p_account,'credits','recurring',false) returning id into wid;
  insert into public.studio_auray_config(wallet_id,account_sha256) values(wid,p_account);
 end if;
 insert into public.studio_video_wallet_access values(wid,p_workspace) on conflict do nothing;
 for item in select value from jsonb_array_elements(p_jobs) loop
  if item->>'request_key' is null or item->>'request_key'!~'^[a-f0-9]{64}$' or item->>'external_id' is distinct from 'video_'||(item->>'request_key') then raise check_violation; end if;
  select * into prior from public.studio_auray_jobs where wallet_id=wid and external_id=item->>'external_id';
  if found then
   if prior.workspace_id<>p_workspace or prior.kind is distinct from item->>'kind' or prior.aspect_ratio is distinct from item->>'aspect_ratio' or prior.expected_sha256 is distinct from item->>'expected_sha256' then raise check_violation using message='Immutable imported job identity'; end if;
  else
   insert into public.studio_auray_jobs(wallet_id,workspace_id,request_key,external_id,label,kind,aspect_ratio,expected_sha256)
    values(wid,p_workspace,item->>'request_key',item->>'external_id',item->>'label',item->>'kind',item->>'aspect_ratio',item->>'expected_sha256');
  end if;
 end loop;
 return wid;
end $$;

alter table public.studio_video_balance_refreshes drop constraint studio_video_balance_refreshes_wallet_id_fkey;
alter table public.studio_video_balance_refreshes add foreign key(wallet_id) references public.studio_video_wallets(id);
create function public.studio_video_balance_request(p_workspace uuid,p_actor uuid,p_wallet uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if not exists(select 1 from public.studio_video_wallet_access where wallet_id=p_wallet and workspace_id=p_workspace) then raise insufficient_privilege; end if;
 if not exists(select 1 from public.studio_auray_config where wallet_id=p_wallet) then
  return public.studio_modal_balance_request(p_workspace,p_actor,p_wallet);
 end if;
 perform 1 from public.studio_video_wallets where id=p_wallet for update;
 if exists(select 1 from public.studio_auray_config where wallet_id=p_wallet and lease_until>now()) or
  exists(select 1 from public.studio_video_balance_refreshes where wallet_id=p_wallet and requested_at>now()-interval '2 minutes') then return '{"code":"waiting"}'; end if;
 insert into public.studio_video_balance_refreshes values(p_wallet,now()) on conflict(wallet_id) do update set requested_at=excluded.requested_at;
 return '{"code":"dispatch","provider":"auray"}';
end $$;

create function public.claim_auray_sync(p_wallet uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.studio_auray_config; jobs jsonb;
begin
 select * into strict c from public.studio_auray_config where wallet_id=p_wallet for update;
 if c.lease_until>now() then return '{"code":"waiting"}'; end if;
 update public.studio_auray_config set lease_token=p_token,lease_until=now()+interval '15 minutes' where wallet_id=p_wallet;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'external_id',external_id,'kind',kind,'aspect_ratio',aspect_ratio,'ready',ready,'status',status,'settled',settled,
  'expected_sha256',expected_sha256,'output_sha256',output_sha256,'bytes',bytes,'path',path) order by created_at,id),'[]') into jobs from public.studio_auray_jobs where wallet_id=p_wallet;
 return jsonb_build_object('code','claimed','account_sha256',c.account_sha256,'jobs',jobs);
end $$;

create function public.auray_monitor_wallet(p_account text) returns uuid
language sql security definer set search_path=public,pg_temp as $$
 select wallet_id from public.studio_auray_config where account_sha256=p_account
$$;
revoke all on function public.auray_monitor_wallet(text) from public,anon,authenticated;
grant execute on function public.auray_monitor_wallet(text) to service_role;

create function public.observe_auray_monitor(p_wallet uuid,p_token uuid,p_observation jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare stamp timestamptz; expiry timestamptz; remaining bigint; key_remaining bigint; allowance bigint;
begin
 perform 1 from public.studio_auray_config where wallet_id=p_wallet and lease_token=p_token and lease_until>now() for update;
 if not found then raise insufficient_privilege; end if;
 stamp:=(p_observation->>'checked_at')::timestamptz;
 if stamp is null or stamp not between now()-interval '2 minutes' and now()+interval '5 seconds' then raise check_violation; end if;
 if p_observation->>'period' is distinct from to_char(now() at time zone 'UTC','YYYY-MM') then raise check_violation; end if;
 if jsonb_typeof(p_observation->'blockers') is distinct from 'array' or p_observation->>'production_ready' is distinct from 'false' then raise check_violation; end if;
 remaining:=(p_observation->>'plan_remaining')::bigint; key_remaining:=(p_observation->>'key_remaining')::bigint; allowance:=(p_observation->>'monthly_allowance')::bigint;
 if remaining is not null and (allowance is null or allowance<=0 or remaining not between 0 and allowance or key_remaining is null or key_remaining not between 0 and allowance) then raise check_violation; end if;
 expiry:=least(stamp+interval '5 minutes',(date_trunc('month',stamp at time zone 'UTC')+interval '1 month') at time zone 'UTC');
 update public.studio_video_wallets set remaining_units=remaining,checked_at=stamp,valid_until=expiry,renews_at=null where id=p_wallet;
 update public.studio_auray_config set observation=jsonb_build_object('checked_at',stamp,'period',p_observation->'period','plan_remaining',remaining,
  'key_remaining',key_remaining,'monthly_allowance',allowance,'blockers',p_observation->'blockers'),sync_error=false where wallet_id=p_wallet;
end $$;

create function public.record_auray_job(p_wallet uuid,p_token uuid,p_job uuid,p_result jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_auray_jobs; result_hash text:=p_result->>'output_sha256';
begin
 perform 1 from public.studio_auray_config where wallet_id=p_wallet and lease_token=p_token and lease_until>now() for update;
 if not found then raise insufficient_privilege; end if;
 select * into strict j from public.studio_auray_jobs where id=p_job and wallet_id=p_wallet for update;
 if j.ready then return; end if;
 if p_result->>'external_id' is distinct from j.external_id or p_result->>'status' is null or p_result->>'settled' is null or p_result->>'charged_credits' is null or
  (p_result->>'charged_credits')::int<j.charged_credits or (j.settled and p_result->>'settled'<>'true') or
  (j.status in ('succeeded','failed','cancelled') and p_result->>'status'<>j.status) then raise check_violation; end if;
 if result_hash is not null and (p_result->>'status'<>'succeeded' or p_result->>'settled'<>'true' or result_hash!~'^[a-f0-9]{64}$' or
  (j.expected_sha256 is not null and j.expected_sha256<>result_hash) or p_result->>'bytes' is null) then raise check_violation; end if;
 update public.studio_auray_jobs set status=p_result->>'status',settled=(p_result->>'settled')::boolean,charged_credits=(p_result->>'charged_credits')::int,
  observed_at=now(),ready=result_hash is not null,output_sha256=result_hash,bytes=(p_result->>'bytes')::int,
  path=case when result_hash is not null then 'auray/'||p_wallet||'/'||p_job||'/'||result_hash||'.mp4' end where id=p_job;
end $$;

create function public.finish_auray_sync(p_wallet uuid,p_token uuid,p_success boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- An old runner cannot clear the newer runner's lease or stale its observation.
 if not exists(select 1 from public.studio_auray_config where wallet_id=p_wallet and lease_token=p_token) then raise insufficient_privilege; end if;
 update public.studio_auray_config set lease_token=null,lease_until=null,sync_error=not p_success where wallet_id=p_wallet and lease_token=p_token;
 if not p_success then update public.studio_video_wallets set valid_until=greatest(checked_at+interval '1 millisecond',now()-interval '1 millisecond') where id=p_wallet and checked_at is not null; end if;
end $$;

create function public.studio_auray_media_read(p_workspace uuid,p_actor uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.studio_auray_jobs;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict j from public.studio_auray_jobs where id=p_job and workspace_id=p_workspace and ready and
  exists(select 1 from public.studio_video_wallet_access where wallet_id=studio_auray_jobs.wallet_id and workspace_id=p_workspace);
 return jsonb_build_object('path',j.path,'bytes',j.bytes,'sha256',j.output_sha256);
end $$;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_auray;
revoke all on function public.studio_video_overview_before_auray(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; wallets jsonb;
begin
 result:=public.studio_video_overview_before_auray(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||case when c.wallet_id is null then '{}'::jsonb else jsonb_build_object(
  'provider','auray','balance_kind','verified_free_credits','source_ready',false,'available_units',null,
  'candidate',true,'monthly_allowance',c.observation->'monthly_allowance','period',c.observation->'period',
  'sync_failed',c.sync_error,'sync_running',coalesce(c.lease_until>now(),false),
  'comparison_only',true,'estimated_complete_chapters',0,
  'budget_only_shots',case when (v->>'balance_fresh')::boolean and not c.sync_error then least((v->>'remaining_units')::bigint,(c.observation->>'key_remaining')::bigint)/5 else null end,
  'source_blockers',coalesce(v->'source_blockers','[]')||coalesce(c.observation->'blockers','[]')||'["continuity_unverified","voice_identity_unverified","production_adapter_pending"]'::jsonb,
  'jobs',(select coalesce(jsonb_agg(x),'[]') from (select id,label,status,settled,charged_credits,ready,observed_at from public.studio_auray_jobs where wallet_id=c.wallet_id and workspace_id=p_workspace order by created_at desc,id limit 20) x)
 ) end order by v->>'label'),'[]') into wallets from jsonb_array_elements(result->'wallets') v
 left join public.studio_auray_config c on c.wallet_id=(v->>'id')::uuid;
 return jsonb_set(result,'{wallets}',wallets);
end $$;

revoke all on function public.guard_auray_candidate_wallet(),public.register_auray_monitor(uuid,text,jsonb),public.studio_video_balance_request(uuid,uuid,uuid),public.claim_auray_sync(uuid,uuid),public.observe_auray_monitor(uuid,uuid,jsonb),public.record_auray_job(uuid,uuid,uuid,jsonb),public.finish_auray_sync(uuid,uuid,boolean),public.studio_auray_media_read(uuid,uuid,uuid),public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_auray_monitor(uuid,text,jsonb),public.studio_video_balance_request(uuid,uuid,uuid),public.claim_auray_sync(uuid,uuid),public.observe_auray_monitor(uuid,uuid,jsonb),public.record_auray_job(uuid,uuid,uuid,jsonb),public.finish_auray_sync(uuid,uuid,boolean),public.studio_auray_media_read(uuid,uuid,uuid),public.studio_video_overview(uuid,uuid) to service_role;
