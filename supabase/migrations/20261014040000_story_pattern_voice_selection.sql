-- Restore the approved voice selection when preparing another visual pattern.
create or replace function public.studio_story_pattern_view(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; pref public.studio_story_presentations; profile jsonb; previous_profile jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace;
 select * into strict pref from public.studio_story_presentations where series_id=s.id and revision=p_revision;
 if not (pref.preferences->'allowed_styles' ? p_style) then raise check_violation;end if;
 select p.profile into profile from public.studio_story_patterns b join public.studio_series_production p using(series_id,profile_sha256)
 where b.series_id=s.id and b.presentation_revision=p_revision and b.style_id=p_style;
 select p.profile into previous_profile from public.studio_chapter_productions b join public.studio_series_production p using(series_id,profile_sha256)
 where b.series_id=s.id order by b.chapter_number desc limit 1;
 if not found then select p.profile into previous_profile from public.studio_series_production p where p.series_id=s.id order by p.created_at,p.profile_sha256 limit 1;end if;
 return jsonb_build_object('series_id',s.id,'bible',s.bible,'revision',p_revision,'style_id',p_style,'source',pref.preferences->>'source','profile',profile,
  'voice_policy',pref.preferences->>'voice_policy','previous_voices',coalesce(previous_profile->'voices','[]'),
  'media',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'character_id',character_id,'kind',kind,'sha256',sha256,'metadata',metadata,'created_at',created_at) order by created_at,id),'[]') from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and ready),
  'can_configure',profile is null and public.story_pattern_editable(s.id) and p_revision=(select max(revision) from public.studio_story_presentations where series_id=s.id) and p_style in ('cinematic_3d','cartoon_2d','anime','realistic'),
  'voice_state',coalesce((select voice_state from public.studio_production_setup where series_id=s.id),'idle'),
  'voice_retry_allowed',coalesce((select attempts<3 and (dispatched_at is null or dispatched_at<=now()-interval '12 minutes') and (lease_until is null or lease_until<=now()) from public.studio_production_setup where series_id=s.id),true),
  'voice_attempts',coalesce((select attempts from public.studio_production_setup where series_id=s.id),0),
  'voice_enabled',coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false));
end $$;
