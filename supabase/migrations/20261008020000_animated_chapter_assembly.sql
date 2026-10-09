-- Mount a complete verified chapter, then let the existing CPU workflow render it.
create table public.studio_animated_renders (
 episode_id uuid primary key references public.episodes(id), request_id uuid not null references public.studio_video_requests(id),
 script_sha256 text not null, profile_sha256 text not null, source_sha256 text not null,
 lease_token uuid, lease_until timestamptz, output_sha256 text, output_path text, quality jsonb,
 completed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.studio_animated_renders enable row level security;
grant all on public.studio_animated_renders to service_role;

create function public.studio_voice_sha256(v jsonb) returns text language sql immutable set search_path=public,pg_temp as $$
 select encode(sha256(convert_to('{"character_id":'||to_jsonb(v->>'character_id')::text||',"engine":'||to_jsonb(v->>'engine')::text||
 ',"sample_sha256":'||to_jsonb(v->>'sample_sha256')::text||',"version":'||to_jsonb(v->>'version')::text||
 ',"voice_id":'||to_jsonb(v->>'voice_id')::text||'}','UTF8')),'hex');
$$;

create function public.mount_animated_chapter(p_episode uuid,p_origin text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; production public.studio_series_production; request public.studio_video_requests;
 scene jsonb; binding jsonb; job public.studio_video_jobs; ticket public.studio_video_worker_tickets;
 updated_script jsonb; source_hash text; n integer; i integer:=0; clip_url text; audio_url text;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 if ep.script_json#>'{fiction,animation}' is null then return '{"code":"not_animated"}'; end if;
 if exists(select 1 from public.studio_animated_renders where episode_id=ep.id) then return '{"code":"mounted"}'; end if;
 if ep.status<>'script' then return '{"code":"invalid_state"}'; end if;
 if p_origin is null or p_origin!~'^https://[a-z0-9-]+\.supabase\.co$' then raise check_violation; end if;
 select * into strict production from public.studio_series_production where workspace_id=ep.workspace_id
  and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid;
 if ep.script_json#>>'{fiction,animation,profile_sha256}' is distinct from production.profile_sha256 or
  production.profile->>'orientation' is distinct from 'portrait' or production.profile->>'output_fps' is distinct from '60' or
  (production.profile->>'short_edge')::integer not between 480 and 704 or
  ep.script_json#>'{fiction,animation}' is distinct from jsonb_build_object('version','1.0.0','profile_sha256',production.profile_sha256,
   'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237) or
  ep.script_json->>'gap_seconds' is distinct from '0' or ep.script_json->'music' is distinct from 'null'::jsonb or
  ep.script_json ? 'platform_ctas' then raise check_violation; end if;
 n:=jsonb_array_length(ep.script_json->'scenes');
 if n not between 5 and 8 then raise check_violation; end if;
 select * into request from public.studio_video_requests where episode_id=ep.id and profile_sha256=production.profile_sha256;
 if not found then return '{"code":"awaiting_plan"}'; end if;
 if request.workspace_id<>ep.workspace_id or jsonb_array_length(request.plan)<>n or
  (select count(*) from public.studio_video_jobs where request_id=request.id)<>n then raise check_violation; end if;
 if exists(select 1 from public.studio_video_jobs where request_id=request.id and state in ('rejected','cancelled','unknown')) then
  return '{"code":"reconciliation_required"}'; end if;
 if exists(select 1 from public.studio_video_jobs where request_id=request.id and state<>'completed') then return '{"code":"waiting_for_clips"}'; end if;
 updated_script:=ep.script_json;
 for scene in select value from jsonb_array_elements(ep.script_json->'scenes') loop
  binding:=scene->'animation';
  select * into strict job from public.studio_video_jobs where request_id=request.id and shot_id=scene->>'id';
  select * into strict ticket from public.studio_video_worker_tickets where job_id=job.id;
  if (scene->>'order')::integer is distinct from i or binding->>'shot_id' is distinct from job.shot_id or
   job.workspace_id<>ep.workspace_id or job.episode_id<>ep.id or job.state<>'completed' or ticket.finished_at is null or
   scene->>'duration_seconds' is distinct from '3.95' or scene->>'transition' is distinct from 'cut' or scene->>'ken_burns' is distinct from 'static' or
   scene->'asset_landscape' is distinct from 'null'::jsonb or
   scene#>>'{story_visual,speaker_id}' is distinct from binding->>'character_id' or
   not coalesce(scene#>'{story_visual,on_stage}' ? (binding->>'character_id'),false) or
   job.input->>'kind' is distinct from 'dialogue' or job.input->>'quality' is distinct from 'approved_master' or
   job.input->>'seconds' is distinct from '3.9375' or job.input->>'min_short_edge' is distinct from '704' or job.input->>'min_output_fps' is distinct from '60' or
   job.input#>>'{continuity,series_id}' is distinct from production.series_id::text or
   job.input#>>'{continuity,profile_sha256}' is distinct from production.profile_sha256 or
   job.input->>'audio_path' is distinct from binding->>'audio_path' or job.input->>'audio_sha256' is distinct from binding->>'audio_sha256' or
   job.input->>'reference_path' is distinct from binding->>'reference_path' or job.input->>'reference_sha256' is distinct from binding->>'reference_sha256' or
   job.input->>'prompt' is distinct from binding->>'prompt' or job.input->>'seed' is distinct from binding->>'seed' or
   not exists(select 1 from jsonb_array_elements(production.profile->'references') r where r->>'character_id'=binding->>'character_id'
    and r->>'path'=binding->>'reference_path' and r->>'sha256'=binding->>'reference_sha256') or
   not exists(select 1 from jsonb_array_elements(production.profile->'voices') v where v->>'character_id'=binding->>'character_id'
    and public.studio_voice_sha256(v)=binding->>'voice_sha256') or
   not exists(select 1 from jsonb_array_elements(request.plan) p where p->>'shot_id'=job.shot_id and p->>'script_sha256'=ep.script_hash) or
   job.output_path is distinct from ticket.output_prefix||'/fluid.mp4' or job.output_sha256 is distinct from ticket.manifests#>>'{fluid,sha256}' or
   ticket.output_prefix not like ep.workspace_id::text||'/videos/'||ep.id::text||'/%' or
   binding->>'audio_path' not like ep.workspace_id::text||'/%' or binding->>'audio_path' ~ '(\.\.|[\\?#])' or
   ticket.report->>'execution_sha256' is distinct from job.execution_sha256 or
   ticket.report->>'reference_sha256' is distinct from binding->>'reference_sha256' or
   ticket.report->>'input_audio_sha256' is distinct from binding->>'audio_sha256' or
   ticket.report->>'input_audio_seconds' is distinct from binding->>'audio_seconds' or
   ticket.report->>'human_review_required' is distinct from 'true' or ticket.report->>'lip_sync_validated' is distinct from 'false' or
   ticket.report->>'native_fps' is distinct from '16' or ticket.report->>'native_frames' is distinct from '64' or
   ticket.report->>'output_fps' is distinct from '60' or ticket.report->>'output_frames' is distinct from '237' or
   ticket.report->>'width' is distinct from '704' or ticket.report->>'height' is distinct from '1280' then raise check_violation; end if;
  clip_url:=p_origin||'/storage/v1/object/authenticated/studio-private/'||job.output_path;
  audio_url:=p_origin||'/storage/v1/object/authenticated/studio-private/'||(binding->>'audio_path');
  insert into public.assets(episode_id,type,url,license,source,metadata) values(ep.id,'video_clip',clip_url,'generated','system',
   jsonb_build_object('scene_order',i,'orientation','portrait','shot_id',job.shot_id,'job_id',job.id,'sha256',job.output_sha256,
    'profile_sha256',production.profile_sha256,'execution_sha256',job.execution_sha256));
  insert into public.assets(episode_id,type,url,license,source,metadata) values(ep.id,'audio',audio_url,'generated','system',
   jsonb_build_object('scene_order',i,'sha256',binding->>'audio_sha256','duration_seconds',binding->'audio_seconds','voice_sha256',binding->>'voice_sha256'));
  updated_script:=jsonb_set(updated_script,array['scenes',i::text,'asset_portrait'],jsonb_build_object('url',clip_url,'license','generated','source','system'));
  i:=i+1;
 end loop;
 source_hash:=encode(sha256(convert_to(updated_script::text,'UTF8')),'hex');
 insert into public.studio_animated_renders(episode_id,request_id,script_sha256,profile_sha256,source_sha256)
 values(ep.id,request.id,ep.script_hash,production.profile_sha256,source_hash);
 update public.episodes set script_json=updated_script,status='assets',metadata=coalesce(metadata,'{}')||jsonb_build_object('animated_mount',
  jsonb_build_object('request_id',request.id,'profile_sha256',production.profile_sha256,'source_sha256',source_hash)) where id=ep.id;
 return '{"code":"mounted"}';
end $$;

create function public.claim_animated_render(p_episode uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; r public.studio_animated_renders;
begin
 if p_token is null then raise insufficient_privilege; end if;
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animated_renders where episode_id=p_episode for update;
 if ep.status<>'assets' or ep.script_hash is distinct from r.script_sha256 or
  encode(sha256(convert_to(ep.script_json::text,'UTF8')),'hex') is distinct from r.source_sha256 then raise check_violation; end if;
 if r.lease_until>now() and r.lease_token is distinct from p_token then return '{"code":"busy"}'; end if;
 -- Rerender clears approval in the existing Studio flow; reuse inputs, never regenerate GPU clips.
 update public.studio_animated_renders set lease_token=p_token,lease_until=now()+interval '35 minutes',completed_at=null where episode_id=p_episode;
 return jsonb_build_object('code','claimed','source_sha256',r.source_sha256,'sources',
  (select jsonb_agg(jsonb_build_object('shot_id',j.shot_id,'output_path',j.output_path,'output_sha256',j.output_sha256,
    'audio_sha256',j.input->>'audio_sha256') order by j.shot_id) from public.studio_video_jobs j where j.request_id=r.request_id and j.state='completed'));
end $$;

create function public.complete_animated_render(p_episode uuid,p_token uuid,p_source text,p_path text,p_hash text,p_quality jsonb,p_origin text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; r public.studio_animated_renders; expected_frames integer; url text;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animated_renders where episode_id=p_episode for update;
 if p_token is null or r.lease_token is null or r.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if r.completed_at is not null then
  if r.output_sha256 is distinct from p_hash or r.output_path is distinct from p_path or r.quality is distinct from p_quality then raise check_violation; end if;
  return '{"code":"saved"}';
 end if;
 expected_frames:=jsonb_array_length(ep.script_json->'scenes')*237;
 if ep.status<>'assets' or coalesce(r.lease_until,'-infinity'::timestamptz)<=now() or p_source is distinct from r.source_sha256 or ep.script_hash is distinct from r.script_sha256 or
  encode(sha256(convert_to(ep.script_json::text,'UTF8')),'hex') is distinct from r.source_sha256 or
  p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_path is distinct from ep.workspace_id||'/animated/'||ep.id||'/'||r.source_sha256||'/'||p_hash||'.mp4' or
  p_origin is null or p_origin!~'^https://[a-z0-9-]+\.supabase\.co$' or
  p_quality->>'profile_sha256' is distinct from r.profile_sha256 or p_quality->>'decode_verified' is distinct from 'true' or
  p_quality->>'version' is distinct from '1.0.0' or p_quality->>'orientation' is distinct from 'portrait' or
  p_quality->>'human_review_required' is distinct from 'true' or p_quality->>'lip_sync_validated' is distinct from 'false' or
  p_quality->>'width' is distinct from '704' or p_quality->>'height' is distinct from '1280' or p_quality->>'fps' is distinct from '60' or
  (p_quality->>'frame_count')::integer is distinct from expected_frames or
  (p_quality->>'duration_seconds')::numeric is distinct from expected_frames::numeric/60 or
  coalesce((p_quality->>'size_bytes')::bigint,0) not between 1 and 52428800 then raise check_violation; end if;
 url:=p_origin||'/storage/v1/object/authenticated/studio-private/'||p_path;
 update public.studio_animated_renders set output_path=p_path,output_sha256=p_hash,quality=p_quality,completed_at=now(),lease_until=null where episode_id=p_episode;
 update public.episodes set status='rendered',render_url=url,render_progress=100,
  metadata=coalesce(metadata,'{}')||jsonb_build_object('render_outputs',jsonb_build_object('portrait',url,'strategy','animated_chapter',
   'completed_at',now(),'quality',jsonb_build_object('portrait',p_quality),'platforms',jsonb_build_object('youtube',jsonb_build_object('portrait',url,'commercial',false),
    'tiktok',jsonb_build_object('portrait',url,'commercial',false,'quality',p_quality)))) where id=p_episode;
 return '{"code":"saved"}';
end $$;

revoke all on function public.studio_voice_sha256(jsonb),public.mount_animated_chapter(uuid,text),public.claim_animated_render(uuid,uuid),
 public.complete_animated_render(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.mount_animated_chapter(uuid,text),public.claim_animated_render(uuid,uuid),
 public.complete_animated_render(uuid,uuid,text,text,text,jsonb,text) to service_role;

-- Reject an incomplete/mismatched chapter before reserving any provider units.
alter function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb) rename to studio_reserve_video_unchecked;
revoke all on function public.studio_reserve_video_unchecked(uuid,uuid,uuid,uuid,text,jsonb) from service_role;
create function public.studio_reserve_video(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; production public.studio_series_production; s jsonb; b jsonb; item jsonb; n integer;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict ep from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 if ep.script_json#>'{fiction,animation}' is not null then
  select * into strict production from public.studio_series_production where workspace_id=p_workspace
   and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid and profile_sha256=p_profile;
  n:=jsonb_array_length(ep.script_json->'scenes');
  if n not between 5 and 8 or jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) is distinct from n or
   production.profile->>'orientation' is distinct from 'portrait' or production.profile->>'output_fps' is distinct from '60' or
   coalesce((production.profile->>'short_edge')::integer,0) not between 480 and 704 or
   ep.script_json#>'{fiction,animation}' is distinct from jsonb_build_object('version','1.0.0','profile_sha256',p_profile,
    'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237) or
   ep.script_json->>'gap_seconds' is distinct from '0' or ep.script_json->'music' is distinct from 'null'::jsonb or
   ep.script_json ? 'platform_ctas' then raise check_violation; end if;
  for s in select value from jsonb_array_elements(ep.script_json->'scenes') loop
   b:=s->'animation';
   select value into strict item from jsonb_array_elements(p_plan) where value->>'shot_id'=s->>'id';
   if b is null or b->>'shot_id' is distinct from s->>'id' or s#>>'{story_visual,speaker_id}' is distinct from b->>'character_id' or
    s->>'duration_seconds' is distinct from '3.95' or s->>'transition' is distinct from 'cut' or s->>'ken_burns' is distinct from 'static' or
    not coalesce(s#>'{story_visual,on_stage}' ? (b->>'character_id'),false) or
    not exists(select 1 from jsonb_array_elements(production.profile->'references') r where r->>'character_id'=b->>'character_id'
     and r->>'path'=b->>'reference_path' and r->>'sha256'=b->>'reference_sha256') or
    not exists(select 1 from jsonb_array_elements(production.profile->'voices') v where v->>'character_id'=b->>'character_id'
     and public.studio_voice_sha256(v)=b->>'voice_sha256') or
    item->'input'->>'kind' is distinct from 'dialogue' or item->'input'->>'seconds' is distinct from '3.9375' or
    item->'input'->>'min_short_edge' is distinct from '704' or item->'input'->>'min_output_fps' is distinct from '60' or
    item->'input'->>'reference_path' is distinct from b->>'reference_path' or item->'input'->>'reference_sha256' is distinct from b->>'reference_sha256' or
    item->'input'->>'audio_path' is distinct from b->>'audio_path' or item->'input'->>'audio_sha256' is distinct from b->>'audio_sha256' or
    item->'input'->>'prompt' is distinct from b->>'prompt' or item->'input'->>'seed' is distinct from b->>'seed' or
    coalesce((b->>'audio_seconds')::numeric,0) not between 0.0000625 and 3.9375 then raise check_violation; end if;
  end loop;
 end if;
 return public.studio_reserve_video_unchecked(p_workspace,p_actor,p_request,p_episode,p_profile,p_plan);
end $$;
revoke all on function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

create function public.studio_animated_progress(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare chapters jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('episode_id',e.id,'series_id',e.briefing#>>'{story_context,series_id}',
  'chapter_number',e.briefing#>'{story_context,chapter_number}','status',e.status,
  'total_shots',jsonb_array_length(e.script_json->'scenes'),'completed_shots',h.completed,'queued_shots',h.queued,
  'active_shots',h.active,'uncertain_shots',h.uncertain,'rejected_shots',h.rejected,
  'planned_seconds',jsonb_array_length(e.script_json->'scenes')*3.95,'output_fps',60,
  'stage',case when e.status in ('rendered','review','published','analyze') then e.status
    when e.status='failed' then 'failed' when h.uncertain>0 or h.rejected>0 then 'reconciliation_required'
    when r.lease_until>now() then 'assembling' when e.status='assets' then 'ready_for_assembly'
    when h.total=0 then 'awaiting_plan' else 'generating_clips' end) order by e.created_at),'[]') into chapters
 from public.episodes e left join public.studio_animated_renders r on r.episode_id=e.id
 cross join lateral (select count(*) total,count(*) filter(where state='completed') completed,
  count(*) filter(where state='queued') queued,count(*) filter(where state in ('submitting','accepted')) active,
  count(*) filter(where state='unknown') uncertain,count(*) filter(where state in ('rejected','cancelled')) rejected
  from public.studio_video_jobs j where j.episode_id=e.id and j.workspace_id=p_workspace) h
 where e.workspace_id=p_workspace and e.script_json#>'{fiction,animation}' is not null;
 return jsonb_build_object('chapters',chapters,'checked_at',now());
end $$;
revoke all on function public.studio_animated_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_animated_progress(uuid,uuid) to service_role;

-- Until the automatic audio/quote dispatcher is wired, identity-bearing series cannot
-- accidentally enter the illustrated writer through a different frontend.
alter function public.studio_story_next(uuid,uuid,uuid) rename to studio_story_next_illustrated;
revoke all on function public.studio_story_next_illustrated(uuid,uuid,uuid) from service_role;
create function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if exists(select 1 from public.studio_series_production where series_id=p_series and workspace_id=p_workspace) then
  return '{"code":"animation_setup_required"}';
 end if;
 return public.studio_story_next_illustrated(p_workspace,p_actor,p_series);
end $$;
revoke all on function public.studio_story_next(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_next(uuid,uuid,uuid) to service_role;

alter function public.studio_story_manage(uuid,uuid,uuid,text) rename to studio_story_manage_illustrated;
revoke all on function public.studio_story_manage_illustrated(uuid,uuid,uuid,text) from service_role;
create function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_action='retry' and exists(select 1 from public.studio_series_production where series_id=p_series and workspace_id=p_workspace) then
  return '{"code":"animation_setup_required"}';
 end if;
 return public.studio_story_manage_illustrated(p_workspace,p_actor,p_series,p_action);
end $$;
revoke all on function public.studio_story_manage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_manage(uuid,uuid,uuid,text) to service_role;
