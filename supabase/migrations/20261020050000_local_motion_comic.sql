create function public.studio_story_local_comic_episode(p_episode uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.episodes e join public.idea_queue i on i.episode_id=e.id and i.workspace_id=e.workspace_id
  join public.studio_story_chapters c on c.idea_id=i.id and c.workspace_id=e.workspace_id
  join public.studio_chapter_presentations b on b.series_id=c.series_id and b.chapter_number=c.chapter_number
  join public.studio_story_presentations p on p.series_id=b.series_id and p.revision=b.revision
  where e.id=p_episode and b.style_id='motion_comic' and p.preferences->>'source'='local' and p.preferences->>'voice_policy'='preserve'
   and e.briefing#>>'{story_context,local_comic}'='true');
$$;
revoke all on function public.studio_story_local_comic_episode(uuid) from public,anon,authenticated;
grant execute on function public.studio_story_local_comic_episode(uuid) to service_role;

alter function public.story_episode_profile_hash(uuid) rename to story_episode_profile_hash_before_comic;
revoke all on function public.story_episode_profile_hash_before_comic(uuid) from service_role;
create function public.story_episode_profile_hash(p_episode uuid) returns text
language plpgsql stable set search_path=public,pg_temp as $$
begin
 if public.studio_story_local_comic_episode(p_episode) then return null;end if;
 return public.story_episode_profile_hash_before_comic(p_episode);
end $$;
revoke all on function public.story_episode_profile_hash(uuid) from public,anon,authenticated;
grant execute on function public.story_episode_profile_hash(uuid) to service_role;

alter function public.studio_story_next_presented(uuid,uuid,uuid,text) rename to studio_story_next_presented_before_comic;
revoke all on function public.studio_story_next_presented_before_comic(uuid,uuid,uuid,text) from service_role;
create function public.studio_story_next_presented(p_workspace uuid,p_actor uuid,p_series uuid,p_style text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.studio_story_presentations;chosen text;result jsonb;prior public.studio_chapter_presentations;idea uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege;end if;
 select * into pref from public.studio_story_presentations where series_id=p_series order by revision desc limit 1;
 chosen:=coalesce(p_style,pref.preferences->>'primary_style');
 if chosen is distinct from 'motion_comic' then return public.studio_story_next_presented_before_comic(p_workspace,p_actor,p_series,p_style);end if;
 if pref.preferences->>'source' is distinct from 'local' or pref.preferences->>'voice_policy' is distinct from 'preserve' or
  not coalesce(pref.preferences->'allowed_styles'?'motion_comic',false) then return '{"code":"style_preparation_required"}';end if;
 if exists(select 1 from public.studio_series_production where series_id=p_series) then return '{"code":"local_comic_new_series_required"}';end if;
 result:=public.studio_story_next_illustrated(p_workspace,p_actor,p_series);
 if result->>'code'='queued' then
  select * into prior from public.studio_chapter_presentations where series_id=p_series and chapter_number=(result->>'chapter_number')::int;
  if found and (prior.revision<>pref.revision or prior.style_id<>'motion_comic') then return '{"code":"existing_chapter_style"}';end if;
  if not found then insert into public.studio_chapter_presentations values(p_series,(result->>'chapter_number')::int,pref.revision,'motion_comic');end if;
  idea:=(result->>'idea_id')::uuid;
  update public.idea_queue set story_context=story_context||'{"local_comic":true}' where id=idea and workspace_id=p_workspace
   and status='pending' and story_context->>'local_comic' is distinct from 'true';
 end if;
 return result;
end $$;
revoke all on function public.studio_story_next_presented(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_next_presented(uuid,uuid,uuid,text) to service_role;