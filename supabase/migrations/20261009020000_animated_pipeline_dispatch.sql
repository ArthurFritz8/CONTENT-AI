-- One chapter step per tick. Workflow retries always address the same durable job.
create table public.studio_animation_dispatches (
 episode_id uuid primary key references public.episodes(id), workflow text not null check(workflow in ('prepare','balance','video')),
 target uuid not null, dispatched_at timestamptz not null, attempts integer not null default 1 check(attempts between 1 and 100)
);
alter table public.studio_animation_dispatches enable row level security;
revoke all on public.studio_animation_dispatches from public,anon,authenticated;
grant all on public.studio_animation_dispatches to service_role;

create function public.studio_animation_step(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; prep public.studio_animation_preparations; production public.studio_series_production; actor uuid;
 wallet uuid; observation jsonb; plan jsonb:='[]'; s jsonb; b jsonb; outcome jsonb;
 job public.studio_video_jobs; prior public.studio_animation_dispatches; action text; target uuid; n integer;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict production from public.studio_series_production where workspace_id=ep.workspace_id and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid;
 if ep.status='research' then
  select * into prep from public.studio_animation_preparations where episode_id=p_episode;
  if not found then return '{"code":"awaiting_draft"}'; end if;
  action:='prepare';target:=ep.id;
 elsif ep.status='script' and ep.script_json#>'{fiction,animation}' is not null then
  if not exists(select 1 from public.studio_video_jobs where episode_id=ep.id) then
   -- Only deployed/qualified executions sharing the frozen series identity are candidates.
   select c.wallet_id,o.observation into wallet,observation from public.studio_video_compatibility c
    join public.studio_video_wallets w on w.id=c.wallet_id
    join public.studio_video_wallet_access a on a.wallet_id=w.id and a.workspace_id=ep.workspace_id
    join public.studio_modal_wallet_config cfg on cfg.wallet_id=w.id
    left join public.studio_modal_observations o on o.wallet_id=w.id
   where c.series_id=production.series_id and c.profile_sha256=production.profile_sha256 and c.revoked_at is null and c.kind='dialogue'
    and c.provider_id='modal-wan-s2v-h100-v1' and w.enabled and w.unit='usd_micro' and w.free_tier='recurring'
    and cfg.adapter_ready and cfg.entitlement_valid_until>now() and cfg.zero_spend_evidence is not null and cfg.zero_spend_valid_until>now()
    and (o.observation is null or c.execution_sha256=o.observation->>'execution_sha256')
   order by case when public.studio_modal_eligible(w.id,c.execution_sha256) and
      w.remaining_units-w.safety_units-(select coalesce(sum(greatest(j.reserved_units,coalesce(j.charged_units,0))),0) from public.studio_video_jobs j where j.wallet_id=w.id and not j.balance_reconciled)
       >=jsonb_array_length(ep.script_json->'scenes')*(o.observation->>'per_shot_units')::bigint then 0
     when o.observation is null or (o.observation->>'valid_until')::timestamptz<=now() then 1 else 2 end,
     (w.remaining_units-w.safety_units-(select coalesce(sum(greatest(j.reserved_units,coalesce(j.charged_units,0))),0) from public.studio_video_jobs j where j.wallet_id=w.id and not j.balance_reconciled)) desc nulls last,w.id limit 1;
   if wallet is null then return '{"code":"source_not_ready"}'; end if;
   if observation is null or (observation->>'valid_until')::timestamptz<=now() then
    action:='balance';target:=wallet;
   else
    for s in select value from jsonb_array_elements(ep.script_json->'scenes') order by (value->>'order')::integer loop
     b:=s->'animation';
     plan:=plan||jsonb_build_array(jsonb_build_object('shot_id',s->>'id','wallet_id',wallet,'provider_id',observation->>'provider_id',
      'execution_sha256',observation->>'execution_sha256','reserved_units',observation->'per_shot_units','cash_cost',0,'script_sha256',ep.script_hash,
      'input',jsonb_build_object('version','1.0.0','id',s->>'id','kind','dialogue','reference_path',b->>'reference_path','reference_sha256',b->>'reference_sha256',
       'audio_path',b->>'audio_path','audio_sha256',b->>'audio_sha256','seconds',3.9375,'prompt',b->>'prompt','seed',b->'seed','quality','approved_master',
       'min_short_edge',704,'min_output_fps',60,'continuity',jsonb_build_object('series_id',production.series_id,'profile_sha256',production.profile_sha256))));
    end loop;
    select user_id into strict actor from public.studio_members where workspace_id=ep.workspace_id and role='owner' order by created_at limit 1;
    outcome:=public.studio_reserve_video(ep.workspace_id,actor,ep.id,ep.id,production.profile_sha256,plan);
    if outcome->>'code'<>'reserved' then return outcome; end if;
   end if;
  end if;
  if action is null then
   -- Poll active/uncertain work before considering any new inference.
   select * into job from public.studio_video_jobs where episode_id=ep.id and state in ('submitting','accepted','unknown') order by created_at,id limit 1;
   if not found then select * into job from public.studio_video_jobs where episode_id=ep.id and state='queued' order by shot_id limit 1; end if;
   if job.id is null then return jsonb_build_object('code',case when exists(select 1 from public.studio_video_jobs where episode_id=ep.id and state in ('rejected','cancelled')) then 'reconciliation_required' else 'ready_for_assembly' end); end if;
   action:='video';target:=job.id;
  end if;
 else return '{"code":"invalid_state"}';
 end if;
 select * into prior from public.studio_animation_dispatches where episode_id=ep.id for update;
 if found and prior.workflow=action and prior.target=target then
  if prior.dispatched_at>now()-interval '20 minutes' then return '{"code":"waiting_for_runner"}'; end if;
  n:=prior.attempts+1;
 else n:=1; end if;
 if n>(case when action='video' then 100 else 3 end) then
  if action='prepare' then update public.episodes set status='failed',failure_reason='animated_audio_preparation_failed' where id=ep.id and status='research'; end if;
  return '{"code":"reconciliation_required"}';
 end if;
 insert into public.studio_animation_dispatches values(ep.id,action,target,now(),n)
 on conflict(episode_id) do update set workflow=excluded.workflow,target=excluded.target,dispatched_at=excluded.dispatched_at,attempts=excluded.attempts;
 return jsonb_build_object('code','dispatch','workflow',action,'target',target);
end $$;
revoke all on function public.studio_animation_step(uuid) from public,anon,authenticated;
grant execute on function public.studio_animation_step(uuid) to service_role;

-- A configured environment may prepare dialogue; production dispatch has an independent flag.
create or replace function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if exists(select 1 from public.studio_series_production where series_id=p_series and workspace_id=p_workspace)
  and not coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false) then
  return '{"code":"animation_setup_required"}';
 end if;
 return public.studio_story_next_illustrated(p_workspace,p_actor,p_series);
end $$;

-- Include draft/audio preparation without inventing rendered frames or future chapter capacity.
alter function public.studio_animated_progress(uuid,uuid) rename to studio_animated_progress_before_preparation;
revoke all on function public.studio_animated_progress_before_preparation(uuid,uuid) from service_role;
create function public.studio_animated_progress(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; preparation jsonb; chapters jsonb;
begin
 result:=public.studio_animated_progress_before_preparation(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('episode_id',e.id,'series_id',r.context->>'series_id','chapter_number',r.context->'chapter_number',
  'status',e.status,'total_shots',jsonb_array_length(r.draft->'scenes'),'completed_shots',0,'prepared_audio',h.n,
  'planned_seconds',jsonb_array_length(r.draft->'scenes')*3.95,'output_fps',60,'stage',case when e.status='failed' then 'failed' else 'preparing_audio' end) order by e.created_at),'[]') into preparation
 from public.studio_animation_preparations r join public.episodes e on e.id=r.episode_id
 cross join lateral (select count(*) n from public.studio_animation_audio a where a.episode_id=e.id) h
 where r.workspace_id=p_workspace and r.completed_at is null and e.status in ('research','failed');
 select coalesce(jsonb_agg(ch||case when exists(select 1 from public.studio_video_jobs j where j.episode_id=(ch->>'episode_id')::uuid
  and j.workspace_id=p_workspace and j.pause_code is not null and j.state in ('queued','submitting','accepted','unknown'))
  then jsonb_build_object('stage','awaiting_capacity') else '{}'::jsonb end),'[]') into chapters from jsonb_array_elements(result->'chapters') ch;
 return jsonb_set(result,'{chapters}',chapters||preparation);
end $$;
revoke all on function public.studio_story_next(uuid,uuid,uuid),public.studio_animated_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_next(uuid,uuid,uuid),public.studio_animated_progress(uuid,uuid) to service_role;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_chapter_quotes;
revoke all on function public.studio_video_overview_before_chapter_quotes(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; quotes jsonb;
begin
 result:=public.studio_video_overview_before_chapter_quotes(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('episode_id',e.id,'series_id',e.briefing#>>'{story_context,series_id}',
  'wallet_id',v->>'id','required_units',jsonb_array_length(e.script_json->'scenes')*(o.observation->>'per_shot_units')::bigint,
  'planned_seconds',jsonb_array_length(e.script_json->'scenes')*3.95,'estimate',true,
  'can_reserve',coalesce((v->>'source_ready')::boolean and (v->>'available_units')::numeric >= jsonb_array_length(e.script_json->'scenes')*(o.observation->>'per_shot_units')::bigint,false)
  ) order by e.created_at,v->>'label'),'[]') into quotes
 from public.episodes e cross join jsonb_array_elements(result->'wallets') v
 join public.studio_modal_observations o on o.wallet_id=(v->>'id')::uuid
 where e.workspace_id=p_workspace and e.status='script' and e.script_json#>'{fiction,animation}' is not null
 and not exists(select 1 from public.studio_video_jobs j where j.episode_id=e.id)
 and exists(select 1 from public.studio_video_compatibility c where c.series_id=(e.briefing#>>'{story_context,series_id}')::uuid
  and c.profile_sha256=e.script_json#>>'{fiction,animation,profile_sha256}' and c.wallet_id=(v->>'id')::uuid and c.revoked_at is null
  and c.provider_id=o.observation->>'provider_id' and c.execution_sha256=o.observation->>'execution_sha256' and c.kind='dialogue');
 return result||jsonb_build_object('chapter_quotes',quotes,'preparation_enabled',
  coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false));
end $$;
revoke all on function public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_overview(uuid,uuid) to service_role;

create or replace function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_action='retry' and exists(select 1 from public.studio_series_production where series_id=p_series and workspace_id=p_workspace) then
  if not coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"animation_setup_required"}'; end if;
  if exists(select 1 from public.studio_video_jobs j join public.idea_queue i on i.episode_id=j.episode_id
   join public.studio_story_chapters c on c.idea_id=i.id
   where c.series_id=p_series and c.workspace_id=p_workspace and c.chapter_number=(select max(chapter_number) from public.studio_story_chapters where series_id=p_series)) then
   return '{"code":"existing_video_work"}'; end if;
 end if;
 return public.studio_story_manage_illustrated(p_workspace,p_actor,p_series,p_action);
end $$;
revoke all on function public.studio_story_manage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_manage(uuid,uuid,uuid,text) to service_role;
