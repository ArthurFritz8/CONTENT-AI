alter table public.studio_puter_preparations add column planning_only boolean not null default false;
alter table public.studio_puter_preparations add column planning_request_id uuid unique;
alter table public.studio_puter_preparations add column planning_actor uuid;
alter table public.studio_puter_preparations add check((planning_request_id is null)=(planning_actor is null));

alter function public.puter_worker_input(uuid) rename to puter_worker_input_before_planning;
revoke all on function public.puter_worker_input_before_planning(uuid) from service_role;
create function public.puter_worker_input(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.studio_puter_preparations where episode_id=p_episode and planning_only) then return '{"code":"native_setup_required"}';end if;
 return public.puter_worker_input_before_planning(p_episode);
end $$;
revoke all on function public.puter_worker_input(uuid) from public,anon,authenticated;
grant execute on function public.puter_worker_input(uuid) to service_role;

alter function public.claim_puter_chapter(uuid,uuid,uuid) rename to claim_puter_chapter_before_planning;
revoke all on function public.claim_puter_chapter_before_planning(uuid,uuid,uuid) from service_role;
create function public.claim_puter_chapter(p_episode uuid,p_account uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.studio_puter_preparations where episode_id=p_episode and planning_only) then return '{"code":"finished"}';end if;
 return public.claim_puter_chapter_before_planning(p_episode,p_account,p_token);
end $$;
revoke all on function public.claim_puter_chapter(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_puter_chapter(uuid,uuid,uuid) to service_role;

alter function public.guard_puter_chapter(uuid,uuid,boolean) rename to guard_puter_chapter_before_planning;
revoke all on function public.guard_puter_chapter_before_planning(uuid,uuid,boolean) from service_role;
create function public.guard_puter_chapter(p_episode uuid,p_token uuid,p_submission boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.studio_puter_preparations where episode_id=p_episode and planning_only) then raise check_violation using message='Planning-only pilot cannot execute';end if;
 perform public.guard_puter_chapter_before_planning(p_episode,p_token,p_submission);
end $$;
revoke all on function public.guard_puter_chapter(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.guard_puter_chapter(uuid,uuid,boolean) to service_role;

create or replace function public.puter_recovery_episodes() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(episode_id),'[]') from (select p.episode_id from public.studio_puter_preparations p
  join public.episodes e on e.id=p.episode_id left join public.studio_puter_runs r on r.episode_id=p.episode_id
  where not p.planning_only and e.status='research' and r.closed_at is null
   and coalesce(p.dispatched_at<now()-interval '40 minutes',true) order by p.created_at limit 3) q;
$$;

create or replace function public.studio_next_episode() returns setof public.episodes
language sql stable security definer set search_path=public,pg_temp as $$
 select e.* from public.episodes e join public.studio_workspaces w on w.id=e.workspace_id
 where e.status in ('idea','research','script','assets','rendered')
   and not exists(select 1 from public.studio_puter_preparations p where p.episode_id=e.id and p.planning_only)
   and (w.id<>'00000000-0000-4000-8000-000000000001' or
    exists(select 1 from public.system_config where key='pipeline' and value->>'enabled'='true'))
 order by e.updated_at,e.id limit 1;
$$;

alter function public.studio_puter_queue_snapshot(uuid,uuid) rename to studio_puter_queue_snapshot_before_planning;
revoke all on function public.studio_puter_queue_snapshot_before_planning(uuid,uuid) from service_role;
create function public.studio_puter_queue_snapshot(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;entries jsonb;
begin
 result:=public.studio_puter_queue_snapshot_before_planning(p_workspace,p_actor);
 select coalesce(jsonb_agg(entry||jsonb_build_object('planning_only',p.planning_only,'dialogue',case when p.planning_only then
   (select jsonb_agg(jsonb_build_object('speaker_id',scene#>>'{visual,speaker_id}','text',scene->>'narration_text') order by position)
    from jsonb_array_elements(p.draft->'scenes') with ordinality as scenes(scene,position)) else '[]'::jsonb end) order by position),'[]') into entries
 from jsonb_array_elements(result->'entries') with ordinality as entries(entry,position)
 join public.studio_puter_preparations p on p.episode_id=(entry->>'id')::uuid and p.workspace_id=p_workspace;
 return jsonb_set(result,'{entries}',entries);
end $$;
revoke all on function public.studio_puter_queue_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_puter_queue_snapshot(uuid,uuid) to service_role;

create function public.studio_puter_pilot_prepare(p_workspace uuid,p_actor uuid,p_request uuid,p_series uuid,p_revision int,p_style text,
 p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;pref public.studio_story_presentations;production public.studio_series_production;prior public.studio_puter_preparations;
 idea public.idea_queue;result jsonb;episode uuid;scene jsonb;visual jsonb;cast_member jsonb;cap int;queue_result jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_request is null or p_revision is null or p_profile is null or p_profile!~'^[a-f0-9]{64}$' or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
   or p_draft is null or jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>32768 then raise check_violation;end if;
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform pg_advisory_xact_lock(hashtext('puter-pilot-'||p_request));
 select * into prior from public.studio_puter_preparations where planning_request_id=p_request;
 if found then
  if not prior.planning_only or prior.workspace_id<>p_workspace or prior.planning_actor<>p_actor or prior.profile_sha256<>p_profile or prior.fingerprint<>p_fingerprint or prior.draft<>p_draft or
   not exists(select 1 from public.episodes e join public.studio_chapter_presentations bound on bound.series_id=p_series and bound.chapter_number=1
    where e.id=prior.episode_id and e.briefing#>>'{story_context,series_id}'=p_series::text and bound.revision=p_revision and bound.style_id=p_style) then raise insufficient_privilege;end if;
   return jsonb_build_object('code','existing','episode_id',prior.episode_id,'planning_only',true);
 end if;
 select * into s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege;end if;
 select * into pref from public.studio_story_presentations where series_id=s.id and revision=p_revision;
 if not found or p_revision<>(select max(revision) from public.studio_story_presentations where series_id=s.id) or
   pref.preferences->>'source' is distinct from 'puter' or pref.preferences->>'voice_policy' is distinct from 'approved_variants' or
   not coalesce(pref.preferences->'allowed_styles'?p_style,false) or s.native_shots<>3 then return '{"code":"profile_incomplete"}';end if;
 select * into production from public.studio_series_production where series_id=s.id and workspace_id=p_workspace and profile_sha256=p_profile;
 if not found or production.profile->>'version' is distinct from 'puter-native-1.0.0' or production.profile->>'native_voice_acknowledged' is distinct from 'true' or
   not exists(select 1 from public.studio_story_patterns where series_id=s.id and presentation_revision=p_revision and style_id=p_style and profile_sha256=p_profile) then return '{"code":"profile_incomplete"}';end if;
 if exists(select 1 from public.studio_story_chapters where series_id=s.id) then return '{"code":"existing_video_work"}';end if;
 if exists(select 1 from public.episodes where workspace_id=p_workspace and status in ('idea','research','script','assets','rendered')) then return '{"code":"production_busy"}';end if;
 select least(3,greatest(1,(settings#>>'{pipeline,max_episodes_per_day}')::int)) into cap from public.studio_workspaces where id=p_workspace;
 if (select count(*) from public.episodes where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cap then return '{"code":"daily_cap_reached"}';end if;
 if p_draft->>'generation_policy' is distinct from 'reference_dialogue_v2' or jsonb_array_length(p_draft->'scenes') is distinct from 3 or
   coalesce(char_length(p_draft->>'title'),0) not between 5 and 100 or coalesce(char_length(p_draft->>'summary'),0) not between 30 and 1200 then raise check_violation;end if;
 for scene in select value from jsonb_array_elements(p_draft->'scenes') loop
   visual:=scene->'visual';
   select value into cast_member from jsonb_array_elements(s.bible->'cast') where value->>'id'=visual->>'speaker_id';
   if cast_member is null or visual->'on_stage' is distinct from jsonb_build_array(visual->>'speaker_id') or
    coalesce(array_length(regexp_split_to_array(btrim(scene->>'narration_text'),'\s+'),1),0) not between 3 and 8 or
    coalesce(char_length(scene->>'prompt'),0) not between 40 and 600 or coalesce((scene->>'seed')::bigint,-1) not between 0 and 2147483647 then raise check_violation;end if;
 end loop;
 if (select count(distinct item.value#>>'{visual,speaker_id}') from jsonb_array_elements(p_draft->'scenes') as item(value))<2 then raise check_violation;end if;
 result:=public.studio_story_next_illustrated(p_workspace,p_actor,s.id);
 if result->>'code'<>'queued' then return result;end if;
 select * into strict idea from public.idea_queue where id=(result->>'idea_id')::uuid and workspace_id=p_workspace for update;
 insert into public.studio_chapter_presentations values(s.id,1,p_revision,p_style);
 insert into public.studio_chapter_productions values(s.id,1,p_profile);
 insert into public.episodes(workspace_id,briefing) values(p_workspace,jsonb_build_object('text',idea.briefing,'story_context',idea.story_context)) returning id into episode;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',idea.story_context),
   metadata=coalesce(metadata,'{}')||'{"puter_chapter":true,"planning_only":true}' where id=episode;
 update public.idea_queue set status='consumed',episode_id=episode,consumed_at=now(),validated_at=now() where id=idea.id;
 insert into public.studio_puter_preparations(episode_id,workspace_id,profile_sha256,fingerprint,draft,planning_only,planning_request_id,planning_actor)
 values(episode,p_workspace,p_profile,p_fingerprint,p_draft,true,p_request,p_actor);
 queue_result:=public.studio_video_enqueue(p_workspace,p_actor,p_request,episode,p_profile);
 if queue_result->>'code' not in ('queued','existing') then raise check_violation using message='Pilot cannot enter reviewed native queue';end if;
 return jsonb_build_object('code','prepared','episode_id',episode,'queue_id',queue_result->'id','planning_only',true);
end $$;
revoke all on function public.studio_puter_pilot_prepare(uuid,uuid,uuid,uuid,int,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_puter_pilot_prepare(uuid,uuid,uuid,uuid,int,text,text,text,jsonb) to service_role;