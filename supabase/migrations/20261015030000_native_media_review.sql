-- Private advisory inspection bound to the exact rendered native film.
create table public.studio_native_media_reviews(
 episode_id uuid primary key references public.episodes(id),workspace_id uuid not null references public.studio_workspaces(id),
 video_sha256 text not null check(video_sha256~'^[a-f0-9]{64}$'),report jsonb not null,created_at timestamptz not null default now()
);
alter table public.studio_native_media_reviews enable row level security;
revoke all on public.studio_native_media_reviews from public,anon,authenticated;
grant select,insert on public.studio_native_media_reviews to service_role;
create function public.save_native_media_review(p_episode uuid,p_report jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs;e public.episodes;t jsonb;i int;
begin
 select * into strict r from public.studio_native_runs where episode_id=p_episode;
 select * into strict e from public.episodes where id=p_episode;
 if e.status not in ('rendered','review') or e.metadata#>>'{render_outputs,sha256}' is distinct from r.state#>>'{output,sha256}' or
  p_report->>'version' is distinct from 'native-media-review-v1' or p_report->>'episode_id' is distinct from e.id::text or
  p_report->>'video_sha256' is distinct from r.state#>>'{output,sha256}' or octet_length(p_report::text)>16384 or
  p_report->>'human_review_required' is distinct from 'true' or p_report->>'lip_sync_verified' is distinct from 'false' or
  p_report->>'identity_verified' is distinct from 'false' or p_report->>'source_video_unchanged' is distinct from 'true' or
  p_report->>'speech_engine' is null or p_report->>'speech_engine' not in ('faster-whisper-base-cpu','unavailable') or
  p_report->>'model_revision' is distinct from 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66' or
  jsonb_typeof(p_report->'takes') is distinct from 'array' or jsonb_array_length(p_report->'takes')<>3 then raise check_violation;end if;
 if (p_report-array['version','episode_id','video_sha256','created_at','speech_engine','model_revision','human_review_required','lip_sync_verified','identity_verified','source_video_unchanged','takes'])<>'{}' then raise check_violation;end if;
 for i in 0..2 loop
  t:=p_report->'takes'->i;
  if t->>'index' is distinct from i::text or t->>'speaker' is distinct from r.state#>>array['draft','scenes',i::text,'visual','speaker_id'] or
   t->>'sha256' is distinct from r.state#>>array['tasks',i::text,'clip','sha256'] or t->>'expected_text' is distinct from r.state#>>array['draft','scenes',i::text,'narration_text'] or
   t->>'recognized_text' is null or char_length(t->>'recognized_text')>600 or t->>'speech_status' is null or
   t->>'speech_status' not in ('no_mismatch_detected','possible_extra_speech','possible_missing_speech','unavailable') or
   t->>'appearance_status' is null or t->>'appearance_status' not in ('no_color_shift_detected','possible_color_shift','unavailable') or
   coalesce((t->>'sampled_frames')::int,-1) not between 0 and 6 or
   (t->'color_shift_score' is distinct from 'null'::jsonb and coalesce((t->>'color_shift_score')::numeric,-1) not between 0 and 1) or
   (t-array['index','speaker','sha256','expected_text','recognized_text','speech_status','appearance_status','sampled_frames','color_shift_score'])<>'{}' then raise check_violation;end if;
 end loop;
 insert into public.studio_native_media_reviews(episode_id,workspace_id,video_sha256,report) values(e.id,e.workspace_id,p_report->>'video_sha256',p_report) on conflict do nothing;
 return '{"code":"saved"}';
end $$;
create function public.studio_native_media_review(p_workspace uuid,p_actor uuid,p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if not exists(select 1 from public.episodes where id=p_episode and workspace_id=p_workspace) then raise insufficient_privilege;end if;
 select r.report into result from public.studio_native_media_reviews r join public.episodes e on e.id=r.episode_id
 where e.id=p_episode and r.workspace_id=p_workspace and r.video_sha256=e.metadata#>>'{render_outputs,sha256}';
 return result;
end $$;
revoke all on function public.save_native_media_review(uuid,jsonb),public.studio_native_media_review(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_native_media_review(uuid,jsonb),public.studio_native_media_review(uuid,uuid,uuid) to service_role;
