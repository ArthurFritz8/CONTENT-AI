create table public.studio_puter_queue (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.studio_workspaces(id),
 actor uuid not null,enqueue_request_id uuid not null unique,episode_id uuid not null unique,
 profile_sha256 text not null check(profile_sha256~'^[a-f0-9]{64}$'),fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 priority int not null default 100 check(priority between 0 and 1000000),
 state text not null default 'pending' check(state in ('pending','cancelled')),
 revision bigint not null default 0 check(revision>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(episode_id,workspace_id) references public.episodes(id,workspace_id)
);
alter table public.studio_puter_queue enable row level security;
revoke all on public.studio_puter_queue from public,anon,authenticated;
grant all on public.studio_puter_queue to service_role;
create index studio_puter_queue_pending on public.studio_puter_queue(workspace_id,priority,created_at,id) where state='pending';

create function public.studio_puter_queue_snapshot(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare entries jsonb;accounts jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 accounts:=public.studio_puter_view(p_workspace,p_actor)->'accounts';
 select coalesce(jsonb_agg(item order by item.priority,item.created_at,item.id),'[]') into entries from (
  select e.id,s.id as series_id,s.bible->>'title' as title,(e.briefing#>>'{story_context,chapter_number}')::int as chapter_number,
   coalesce(q.priority,100) as priority,extract(epoch from coalesce(q.created_at,p.created_at))*1000 as created_at,
   q.id as queue_id,coalesce(q.revision,0) as revision,coalesce(q.state,'prepared') as state,p.profile_sha256,
   public.native_chapter_shots(e.briefing->'story_context') as shots,
   coalesce(e.status='research' and not p.cancel_requested and p.fingerprint is not null and jsonb_array_length(p.draft->'scenes')=3,false) as prepared,
   coalesce(profile.profile->>'version'='puter-native-1.0.0' and profile.profile->>'model'='togetherai:wan-ai/wan2.7-i2v'
    and profile.profile->>'contract_sha256'='af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364'
    and profile.profile->>'output_fps'='30' and profile.profile->>'width'='720' and profile.profile->>'height'='1280'
    and profile.profile->>'voice_policy'='provider_generated_review' and profile.profile->>'native_voice_acknowledged'='true'
    and public.story_episode_profile_hash(e.id)=p.profile_sha256 and pref.preferences->>'voice_policy'='approved_variants'
    and exists(select 1 from public.studio_story_style_samples sample where sample.id=(profile.profile#>>'{example,id}')::uuid
     and sample.workspace_id=p_workspace and sample.ready and sample.sample->>'source'='puter' and sample.sample->>'style_id'=bound.style_id
     and sample.sample->>'sha256'=profile.profile#>>'{example,sha256}' and sample.sample->>'review_scope'='reviewed_sample' and sample.sample->>'has_audio'='true'),false) as profile_ready,
   (e.briefing#>>'{story_context,chapter_number}'='1' or exists(select 1 from public.studio_story_chapters c
    join public.idea_queue i on i.id=c.idea_id join public.episodes previous on previous.id=i.episode_id and previous.workspace_id=p_workspace
    where c.series_id=s.id and c.workspace_id=p_workspace and c.chapter_number=(e.briefing#>>'{story_context,chapter_number}')::int-1
     and previous.status in ('review','published','analyze') and previous.approval_fingerprint=public.review_fingerprint(previous)
     and exists(select 1 from public.review_requests r where r.episode_id=previous.id and r.decision='approved' and r.fingerprint=previous.approval_fingerprint))) as previous_approved,
   case when run.closed_at is not null then 'cancelled'
    when p.cancel_requested then 'cancellation_pending'
    when q.id is not null and (q.profile_sha256 is distinct from p.profile_sha256 or q.fingerprint is distinct from p.fingerprint) then 'script_changed'
    when e.status in ('rendered','review','published','analyze') then case when e.approval_fingerprint=public.review_fingerprint(e)
     and exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=e.approval_fingerprint)
     then 'completed' else 'waiting_review' end
    when e.status<>'research' then 'existing_video_work'
    when run.episode_id is not null and exists(select 1 from jsonb_array_elements(run.state->'tasks') task
     where task->>'phase' in ('submission_started','submission_unknown','failed')) then 'reconciliation_required'
    when run.episode_id is not null then 'reserved'
    when exists(select 1 from public.studio_puter_preparations other join public.episodes other_ep on other_ep.id=other.episode_id
     join public.studio_puter_runs other_run on other_run.episode_id=other.episode_id
     where other.workspace_id=p_workspace and other.episode_id<>e.id and other_ep.briefing#>>'{story_context,series_id}'=s.id::text
      and other_run.held) then 'waiting_previous_chapter' else null end as blocked_code
  from public.studio_puter_preparations p join public.episodes e on e.id=p.episode_id and e.workspace_id=p.workspace_id
  join public.studio_series s on s.workspace_id=p_workspace and s.id=(e.briefing#>>'{story_context,series_id}')::uuid
  join public.studio_chapter_presentations bound on bound.series_id=s.id and bound.chapter_number=(e.briefing#>>'{story_context,chapter_number}')::int
  join public.studio_story_presentations pref on pref.series_id=s.id and pref.revision=bound.revision and pref.preferences->>'source'='puter'
  join public.studio_series_production profile on profile.series_id=s.id and profile.workspace_id=p_workspace and profile.profile_sha256=p.profile_sha256
  left join public.studio_puter_queue q on q.episode_id=e.id and q.workspace_id=p_workspace
  left join public.studio_puter_runs run on run.episode_id=e.id
  where p.workspace_id=p_workspace and s.archived_at is null and coalesce(q.state,'prepared')<>'cancelled'
  order by coalesce(q.priority,100),coalesce(q.created_at,p.created_at),e.id limit 101
 ) item;
 return jsonb_build_object('entries',entries,'accounts',accounts,'checked_at',extract(epoch from now())*1000);
end $$;
revoke all on function public.studio_puter_queue_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_puter_queue_snapshot(uuid,uuid) to service_role;

alter function public.studio_video_enqueue(uuid,uuid,uuid,uuid,text,int) rename to studio_video_enqueue_before_puter;
revoke all on function public.studio_video_enqueue_before_puter(uuid,uuid,uuid,uuid,text,int) from service_role;
create function public.studio_video_enqueue(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_priority int default 100) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_puter_queue;entry jsonb;prep public.studio_puter_preparations;ep public.episodes;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into ep from public.episodes where id=p_episode and workspace_id=p_workspace;
 if not found then raise insufficient_privilege;end if;
 if p_request is null or p_profile is null or p_profile!~'^[a-f0-9]{64}$' or p_priority is null or p_priority not between 0 and 1000000 then raise check_violation;end if;
 insert into public.studio_video_queue_cursors(workspace_id) values(p_workspace) on conflict do nothing;
 perform 1 from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 perform pg_advisory_xact_lock(hashtext('video-queue-enqueue-'||p_request));
 if not exists(select 1 from public.studio_puter_preparations where episode_id=p_episode and workspace_id=p_workspace) then
  if exists(select 1 from public.studio_puter_queue where enqueue_request_id=p_request) then raise insufficient_privilege;end if;
  return public.studio_video_enqueue_before_puter(p_workspace,p_actor,p_request,p_episode,p_profile,p_priority);
 end if;
 if exists(select 1 from public.studio_video_queue where enqueue_request_id=p_request) then raise insufficient_privilege;end if;
 select * into prior from public.studio_puter_queue where enqueue_request_id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.episode_id<>p_episode or prior.profile_sha256<>p_profile or prior.priority<>p_priority then raise insufficient_privilege;end if;
  return jsonb_build_object('code','queued','id',prior.id,'state',prior.state,'revision',prior.revision);
 end if;
 perform 1 from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 select * into strict prep from public.studio_puter_preparations where episode_id=p_episode and workspace_id=p_workspace for update;
 select * into prior from public.studio_puter_queue where episode_id=p_episode;
 if found then
  if prior.profile_sha256 is distinct from p_profile or prior.fingerprint is distinct from prep.fingerprint then return '{"code":"queue_version_changed"}';end if;
  return jsonb_build_object('code','existing','id',prior.id,'state',prior.state,'revision',prior.revision);
 end if;
 select value into entry from jsonb_array_elements(public.studio_puter_queue_snapshot(p_workspace,p_actor)->'entries') where value->>'id'=p_episode::text;
 if entry is null or entry->>'prepared' is distinct from 'true' or entry->>'profile_ready' is distinct from 'true' or
  entry->>'profile_sha256' is distinct from p_profile or entry->>'blocked_code' is not null or entry->>'shots'<>'3' then return '{"code":"chapter_not_prepared"}';end if;
 if exists(select 1 from public.studio_puter_runs where episode_id=p_episode) then return '{"code":"existing_video_work"}';end if;
 insert into public.studio_puter_queue(workspace_id,actor,enqueue_request_id,episode_id,profile_sha256,fingerprint,priority)
 values(p_workspace,p_actor,p_request,p_episode,p_profile,prep.fingerprint,p_priority) returning * into prior;
 return jsonb_build_object('code','queued','id',prior.id,'state',prior.state,'revision',prior.revision);
end $$;
revoke all on function public.studio_video_enqueue(uuid,uuid,uuid,uuid,text,int) from public,anon,authenticated;
grant execute on function public.studio_video_enqueue(uuid,uuid,uuid,uuid,text,int) to service_role;

alter function public.studio_video_queue_cancel(uuid,uuid,uuid,bigint) rename to studio_video_queue_cancel_before_puter;
revoke all on function public.studio_video_queue_cancel_before_puter(uuid,uuid,uuid,bigint) from service_role;
create function public.studio_video_queue_cancel(p_workspace uuid,p_actor uuid,p_queue uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare entry public.studio_puter_queue;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 select * into entry from public.studio_puter_queue where id=p_queue and workspace_id=p_workspace for update;
 if not found then return public.studio_video_queue_cancel_before_puter(p_workspace,p_actor,p_queue,p_revision);end if;
 if entry.state='cancelled' then return '{"code":"cancelled"}';end if;
 if entry.revision is distinct from p_revision then return '{"code":"queue_version_changed"}';end if;
 perform 1 from public.episodes where id=entry.episode_id and workspace_id=p_workspace for update;
 if exists(select 1 from public.studio_puter_runs where episode_id=entry.episode_id) then return '{"code":"existing_video_work"}';end if;
 update public.studio_puter_queue set state='cancelled',revision=revision+1,updated_at=now() where id=entry.id;
 return '{"code":"cancelled"}';
end $$;
revoke all on function public.studio_video_queue_cancel(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.studio_video_queue_cancel(uuid,uuid,uuid,bigint) to service_role;