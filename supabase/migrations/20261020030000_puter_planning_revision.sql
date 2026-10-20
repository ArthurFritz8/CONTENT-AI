create function public.studio_puter_pilot_revise(p_workspace uuid,p_actor uuid,p_episode uuid,p_revision bigint,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prep public.studio_puter_preparations;entry public.studio_puter_queue;scene jsonb;context jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_revision is null or p_revision<0 or p_profile is null or p_profile!~'^[a-f0-9]{64}$' or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
  or p_draft is null or jsonb_typeof(p_draft) is distinct from 'object' or octet_length(p_draft::text)>32768 then raise check_violation;end if;
 perform 1 from public.studio_video_queue_cursors where workspace_id=p_workspace for update;
 select * into entry from public.studio_puter_queue where episode_id=p_episode and workspace_id=p_workspace for update;
 if not found then raise insufficient_privilege;end if;
 select briefing->'story_context' into context from public.episodes where id=p_episode and workspace_id=p_workspace and status='research' for update;
 if not found then return '{"code":"existing_video_work"}';end if;
 select * into strict prep from public.studio_puter_preparations where episode_id=p_episode and workspace_id=p_workspace for update;
 if not prep.planning_only or prep.planning_actor is distinct from p_actor or prep.cancel_requested or entry.state<>'pending' or prep.profile_sha256<>p_profile or
  public.story_episode_profile_hash(p_episode) is distinct from p_profile or exists(select 1 from public.studio_puter_runs where episode_id=p_episode) or
  exists(select 1 from public.studio_video_jobs where episode_id=p_episode) then return '{"code":"existing_video_work"}';end if;
 if prep.fingerprint=p_fingerprint and prep.draft=p_draft then return jsonb_build_object('code','existing','episode_id',p_episode,'planning_only',true);end if;
 if entry.revision<>p_revision then return '{"code":"queue_version_changed"}';end if;
 if p_draft->>'generation_policy' is distinct from 'reference_dialogue_v2' or jsonb_array_length(p_draft->'scenes') is distinct from 3 or
  coalesce(char_length(p_draft->>'title'),0) not between 5 and 100 or coalesce(char_length(p_draft->>'summary'),0) not between 30 and 1200 then raise check_violation;end if;
 for scene in select value from jsonb_array_elements(p_draft->'scenes') loop
  if not exists(select 1 from jsonb_array_elements(context#>'{bible,cast}') character where character->>'id'=scene#>>'{visual,speaker_id}') or
   scene#>'{visual,on_stage}' is distinct from jsonb_build_array(scene#>>'{visual,speaker_id}') or
   coalesce(array_length(regexp_split_to_array(btrim(scene->>'narration_text'),'\s+'),1),0) not between 3 and 8 or
   coalesce(char_length(scene->>'prompt'),0) not between 40 and 600 or coalesce((scene->>'seed')::bigint,-1) not between 0 and 2147483647 then raise check_violation;end if;
 end loop;
 if (select count(distinct item.value#>>'{visual,speaker_id}') from jsonb_array_elements(p_draft->'scenes') item(value))<2 then raise check_violation;end if;
 update public.studio_puter_preparations set draft=p_draft,fingerprint=p_fingerprint where episode_id=p_episode;
 update public.studio_puter_queue set fingerprint=p_fingerprint,revision=revision+1,updated_at=now() where id=entry.id;
 return jsonb_build_object('code','revised','episode_id',p_episode,'planning_only',true);
end $$;
revoke all on function public.studio_puter_pilot_revise(uuid,uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_puter_pilot_revise(uuid,uuid,uuid,bigint,text,text,jsonb) to service_role;