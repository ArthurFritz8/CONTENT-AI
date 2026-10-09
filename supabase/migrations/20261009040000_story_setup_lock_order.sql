-- Use the same workspace -> series order as archive/retry and the existing chapter
-- command. Profile finalization still serializes on the same series row.
create or replace function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege; end if;
 if not exists(select 1 from public.studio_series_production where series_id=p_series) and
  (exists(select 1 from public.studio_production_media where series_id=p_series) or exists(select 1 from public.studio_production_setup where series_id=p_series)) then return '{"code":"profile_incomplete"}'; end if;
 return public.studio_story_next_before_setup(p_workspace,p_actor,p_series);
end $$;
revoke all on function public.studio_story_next(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_next(uuid,uuid,uuid) to service_role;
