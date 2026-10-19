create table public.studio_video_queue_cursors (
 workspace_id uuid primary key references public.studio_workspaces(id),
 after_quota_group text,revision bigint not null default 0 check(revision>=0),updated_at timestamptz not null default now()
);
create table public.studio_video_queue (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.studio_workspaces(id),
 actor uuid not null,enqueue_request_id uuid not null unique,episode_id uuid not null unique,
 profile_sha256 text not null check(profile_sha256~'^[a-f0-9]{64}$'),script_sha256 text not null check(script_sha256~'^[a-f0-9]{64}$'),
 priority int not null default 100 check(priority between 0 and 1000000),
 state text not null default 'pending' check(state in ('pending','reserved','cancelled')),
 reservation_request_id uuid unique references public.studio_video_requests(id),
 provider_id text,wallet_id uuid references public.studio_video_wallets(id),
 last_code text check(last_code in ('queue_disabled','waiting_review','script_changed','existing_video_work','wallet_reconciliation_required',
  'capacity_unavailable','insufficient_capacity','series_incompatible','source_not_ready','reservation_unavailable')),
 revision bigint not null default 0 check(revision>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(episode_id,workspace_id) references public.episodes(id,workspace_id),
 check((state='reserved')=(reservation_request_id is not null)),
 check((state='reserved')=(provider_id is not null and wallet_id is not null))
);
create index studio_video_queue_pending on public.studio_video_queue(workspace_id,priority,created_at,id) where state='pending';
alter table public.studio_video_queue_cursors enable row level security;
alter table public.studio_video_queue enable row level security;
revoke all on public.studio_video_queue_cursors,public.studio_video_queue from public,anon,authenticated;
grant all on public.studio_video_queue_cursors,public.studio_video_queue to service_role;

create function public.studio_video_enqueue(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_priority int default 100) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_video_queue;ep public.episodes;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_request is null or p_profile is null or p_profile!~'^[a-f0-9]{64}$' or p_priority is null or p_priority not between 0 and 1000000 then raise check_violation;end if;
 insert into public.studio_video_queue_cursors(workspace_id) values(p_workspace) on conflict do nothing;
 perform 1 from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 perform pg_advisory_xact_lock(hashtext('video-queue-enqueue-'||p_request));
 select * into prior from public.studio_video_queue where enqueue_request_id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.episode_id<>p_episode or prior.profile_sha256<>p_profile or prior.priority<>p_priority then raise insufficient_privilege;end if;
  return jsonb_build_object('code','queued','id',prior.id,'state',prior.state,'revision',prior.revision);
 end if;
 select * into ep from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 if not found then raise insufficient_privilege;end if;
 select * into prior from public.studio_video_queue where episode_id=p_episode;
 if found then
  if prior.workspace_id<>p_workspace or prior.profile_sha256<>p_profile or prior.script_sha256 is distinct from ep.script_hash then return '{"code":"queue_version_changed"}';end if;
  return jsonb_build_object('code','existing','id',prior.id,'state',prior.state,'revision',prior.revision);
 end if;
 if ep.status<>'script' or ep.script_hash is null or public.story_episode_profile_hash(ep.id) is distinct from p_profile or
  jsonb_typeof(ep.script_json#>'{fiction,animation}') is distinct from 'object' or ep.script_json#>'{fiction,native_animation}' is not null then
  return '{"code":"chapter_not_prepared"}';
 end if;
 if exists(select 1 from public.studio_video_jobs where episode_id=ep.id) then return '{"code":"existing_video_work"}';end if;
 insert into public.studio_video_queue(workspace_id,actor,enqueue_request_id,episode_id,profile_sha256,script_sha256,priority)
 values(p_workspace,p_actor,p_request,p_episode,p_profile,ep.script_hash,p_priority) returning * into prior;
 return jsonb_build_object('code','queued','id',prior.id,'state',prior.state,'revision',prior.revision);
end $$;

create function public.studio_video_queue_cancel(p_workspace uuid,p_actor uuid,p_queue uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.studio_video_queue;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 select * into entry from public.studio_video_queue where id=p_queue and workspace_id=p_workspace for update;
 if not found then raise insufficient_privilege;end if;
 if entry.state='cancelled' then return '{"code":"cancelled"}';end if;
 if p_revision is distinct from entry.revision then return '{"code":"queue_version_changed"}';end if;
 if entry.state<>'pending' or exists(select 1 from public.studio_video_jobs where episode_id=entry.episode_id) then return '{"code":"existing_video_work"}';end if;
 update public.studio_video_queue set state='cancelled',revision=revision+1,updated_at=now() where id=entry.id;
 return '{"code":"cancelled"}';
end $$;

revoke all on function public.studio_video_enqueue(uuid,uuid,uuid,uuid,text,int),public.studio_video_queue_cancel(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.studio_video_enqueue(uuid,uuid,uuid,uuid,text,int),public.studio_video_queue_cancel(uuid,uuid,uuid,bigint) to service_role;

insert into public.system_config(key,value) values('video_queue','{"reservation_enabled":false}') on conflict do nothing;

create function public.studio_video_queue_reserve(p_workspace uuid,p_actor uuid,p_queue uuid,p_request uuid,
 p_revision bigint,p_cursor_revision bigint,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.studio_video_queue;cursor_row public.studio_video_queue_cursors;ep public.episodes;
 prior public.studio_video_requests;outcome jsonb;wallet uuid;provider text;group_name text;series uuid;chapter int;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_request is null or p_revision is null or p_revision<0 or p_cursor_revision is null or p_cursor_revision<0 or
    jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 100 then raise check_violation;end if;
 select * into strict cursor_row from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 select * into entry from public.studio_video_queue where id=p_queue and workspace_id=p_workspace for update;
 if not found then raise insufficient_privilege;end if;
 if entry.state='reserved' then
    select * into strict prior from public.studio_video_requests where id=entry.reservation_request_id;
    if prior.id=p_request and prior.actor=p_actor and prior.plan=p_plan then
     return jsonb_build_object('code','reserved','queue_id',entry.id,'revision',entry.revision,'cursor_revision',cursor_row.revision,
        'job_ids',(select jsonb_agg(id order by shot_id) from public.studio_video_jobs where request_id=prior.id));
    end if;
    return '{"code":"already_reserved"}';
 end if;
 if entry.state='cancelled' then return '{"code":"cancelled"}';end if;
 if entry.revision<>p_revision or cursor_row.revision<>p_cursor_revision then return '{"code":"queue_version_changed"}';end if;
 if not coalesce((select value->>'reservation_enabled'='true' from public.system_config where key='video_queue'),false) then
    update public.studio_video_queue set last_code='queue_disabled',updated_at=now() where id=entry.id;
    return '{"code":"queue_disabled"}';
 end if;
 select * into strict ep from public.episodes where id=entry.episode_id and workspace_id=p_workspace for update;
 if ep.status<>'script' or ep.script_hash is distinct from entry.script_sha256 or
    public.story_episode_profile_hash(ep.id) is distinct from entry.profile_sha256 then
    update public.studio_video_queue set last_code='script_changed',updated_at=now() where id=entry.id;
    return '{"code":"script_changed"}';
 end if;
 series:=(ep.briefing#>>'{story_context,series_id}')::uuid;chapter:=(ep.briefing#>>'{story_context,chapter_number}')::int;
 if series is null or chapter is null or chapter not between 1 and 60 or
    not exists(select 1 from public.studio_series where id=series and workspace_id=p_workspace and archived_at is null) then raise check_violation;end if;
 if chapter>1 then
   perform 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id
    join public.episodes previous on previous.id=i.episode_id and previous.workspace_id=p_workspace
    where c.series_id=series and c.workspace_id=p_workspace and c.chapter_number=chapter-1 for update of previous;
 end if;
 if chapter>1 and not exists(select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id
    join public.episodes previous on previous.id=i.episode_id and previous.workspace_id=p_workspace
    where c.series_id=series and c.workspace_id=p_workspace and c.chapter_number=chapter-1
     and previous.status in ('review','published','analyze') and previous.approval_fingerprint is not null
     and previous.approval_fingerprint=public.review_fingerprint(previous)
     and exists(select 1 from public.review_requests r where r.episode_id=previous.id and r.decision='approved' and r.fingerprint=previous.approval_fingerprint)) then
    update public.studio_video_queue set last_code='waiting_review',updated_at=now() where id=entry.id;
    return '{"code":"waiting_review"}';
 end if;
 if exists(select 1 from public.studio_video_jobs j join public.episodes other on other.id=j.episode_id
    where other.workspace_id=p_workspace and other.id<>ep.id and other.briefing#>>'{story_context,series_id}'=series::text
     and j.state in ('queued','submitting','accepted','unknown')) or
    exists(select 1 from public.studio_video_jobs where episode_id=ep.id) then
    update public.studio_video_queue set last_code='existing_video_work',updated_at=now() where id=entry.id;
    return '{"code":"existing_video_work"}';
 end if;
 if (select count(distinct value->>'wallet_id') from jsonb_array_elements(p_plan))<>1 or
    (select count(distinct value->>'provider_id') from jsonb_array_elements(p_plan))<>1 or
    (select count(distinct value->>'execution_sha256') from jsonb_array_elements(p_plan))<>1 or
    exists(select 1 from jsonb_array_elements(p_plan) item where item->>'wallet_id' is null or item->>'provider_id' is null) then raise check_violation;end if;
 wallet:=(p_plan->0->>'wallet_id')::uuid;provider:=p_plan->0->>'provider_id';
 select quota_group into strict group_name from public.studio_video_wallets where id=wallet for update;
 if not exists(select 1 from public.studio_video_wallet_access where wallet_id=wallet and workspace_id=p_workspace) then raise insufficient_privilege;end if;
 if exists(select 1 from public.studio_video_jobs where wallet_id=wallet and state in ('submitting','accepted','unknown') and not balance_reconciled) then
    update public.studio_video_queue set last_code='wallet_reconciliation_required',updated_at=now() where id=entry.id;
    return '{"code":"wallet_reconciliation_required"}';
 end if;
 outcome:=public.studio_reserve_video(p_workspace,p_actor,p_request,ep.id,entry.profile_sha256,p_plan);
 if outcome->>'code' is distinct from 'reserved' then
    update public.studio_video_queue set last_code=case when outcome->>'code' in ('capacity_unavailable','insufficient_capacity','series_incompatible','source_not_ready')
     then outcome->>'code' else 'reservation_unavailable' end,updated_at=now() where id=entry.id;
    return outcome;
 end if;
 update public.studio_video_queue set state='reserved',reservation_request_id=p_request,provider_id=provider,wallet_id=wallet,
    last_code=null,revision=revision+1,updated_at=now() where id=entry.id;
 update public.studio_video_queue_cursors set after_quota_group=group_name,revision=revision+1,updated_at=now() where workspace_id=p_workspace;
 return outcome||jsonb_build_object('queue_id',entry.id,'revision',entry.revision+1,'cursor_revision',cursor_row.revision+1);
end $$;

create function public.studio_video_queue_view(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare cursor_row public.studio_video_queue_cursors;items jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into cursor_row from public.studio_video_queue_cursors where workspace_id=p_workspace;
 select coalesce(jsonb_agg(item order by item.priority,item.created_at,item.id),'[]') into items from
    (select q.id,q.episode_id,q.state,q.priority,q.revision,q.last_code,q.created_at,q.updated_at,
        e.status as episode_status,e.briefing#>'{story_context,chapter_number}' as chapter_number,
        w.label as source_label,w.unit,q.provider_id
     from public.studio_video_queue q join public.episodes e on e.id=q.episode_id and e.workspace_id=q.workspace_id
     left join public.studio_video_wallets w on w.id=q.wallet_id where q.workspace_id=p_workspace
     order by q.priority,q.created_at,q.id limit 100) item;
 return jsonb_build_object('items',items,'cursor_revision',coalesce(cursor_row.revision,0),
    'after_quota_group',cursor_row.after_quota_group,'reservation_enabled',coalesce((select value->>'reservation_enabled'='true' from public.system_config where key='video_queue'),false),
    'dispatch_enabled',false);
end $$;

revoke all on function public.studio_video_queue_reserve(uuid,uuid,uuid,uuid,bigint,bigint,jsonb),public.studio_video_queue_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_queue_reserve(uuid,uuid,uuid,uuid,bigint,bigint,jsonb),public.studio_video_queue_view(uuid,uuid) to service_role;