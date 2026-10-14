-- Reviewed style patterns share immutable profiles; chapters freeze an exact profile.
alter table public.studio_series_production drop constraint studio_series_production_pkey;
alter table public.studio_series_production add primary key(series_id,profile_sha256);
alter table public.studio_series_production add column legacy_identity boolean not null default true;
create table public.studio_story_patterns (
 series_id uuid not null,presentation_revision int not null,style_id text not null,profile_sha256 text not null,
 created_by uuid not null,created_at timestamptz not null default now(),
 primary key(series_id,presentation_revision,style_id),
 foreign key(series_id,presentation_revision) references public.studio_story_presentations(series_id,revision),
 foreign key(series_id,profile_sha256) references public.studio_series_production(series_id,profile_sha256)
);
create table public.studio_chapter_productions (
 series_id uuid not null,chapter_number int not null,profile_sha256 text not null,
 primary key(series_id,chapter_number),
 foreign key(series_id,chapter_number) references public.studio_chapter_presentations(series_id,chapter_number),
 foreign key(series_id,profile_sha256) references public.studio_series_production(series_id,profile_sha256)
);
alter table public.studio_story_patterns enable row level security;
alter table public.studio_chapter_productions enable row level security;
revoke all on public.studio_story_patterns,public.studio_chapter_productions from public,anon,authenticated;
grant all on public.studio_story_patterns,public.studio_chapter_productions to service_role;
create trigger story_patterns_immutable before update or delete on public.studio_story_patterns for each row execute function public.guard_story_style_history();
create trigger chapter_productions_immutable before update or delete on public.studio_chapter_productions for each row execute function public.guard_story_style_history();

create function public.story_pattern_editable(p_series uuid) returns boolean language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.studio_story_presentations p join public.studio_series s on s.id=p.series_id
 where s.id=p_series and s.archived_at is null and p.revision=(select max(revision) from public.studio_story_presentations where series_id=s.id)
 and p.preferences->>'source' in ('automatic','modal')
 and exists(select 1 from jsonb_array_elements_text(p.preferences->'allowed_styles') x where x in ('cinematic_3d','cartoon_2d','anime','realistic')
  and not exists(select 1 from public.studio_story_patterns v where v.series_id=s.id and v.presentation_revision=p.revision and v.style_id=x))
 and not exists(select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id left join public.episodes e on e.id=i.episode_id
  where c.series_id=s.id and (i.status='pending' or e.id is null or e.status in ('idea','research','script','assets','rendered','failed') or not exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e))))
 and coalesce((select max(chapter_number) from public.studio_story_chapters where series_id=s.id),0)<jsonb_array_length(s.bible->'chapters'));
$$;

create function public.story_episode_profile_hash(p_episode uuid) returns text language plpgsql stable set search_path=public,pg_temp as $$
declare ep public.episodes; sid uuid; bound public.studio_chapter_presentations; answer text; n int;
begin
 select * into strict ep from public.episodes where id=p_episode;sid:=(ep.briefing#>>'{story_context,series_id}')::uuid;
 select b.* into bound from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id
  join public.studio_chapter_presentations b using(series_id,chapter_number) where c.series_id=sid and c.workspace_id=ep.workspace_id and i.episode_id=ep.id;
 if found and bound.revision is not null then
  if bound.style_id='illustrated' then return null;end if;
  select profile_sha256 into strict answer from public.studio_chapter_productions where series_id=sid and chapter_number=bound.chapter_number;
  return answer;
 end if;
 -- An old chapter remains on its original profile even after new pattern versions exist.
 if exists(select 1 from public.studio_story_presentations where series_id=sid) and not found then raise check_violation using message='Missing chapter style binding';end if;
 select count(*),min(profile_sha256) into n,answer from public.studio_series_production where series_id=sid and workspace_id=ep.workspace_id
 and legacy_identity;
 if n>1 then raise check_violation using message='Ambiguous legacy production profile';end if;
 return answer;
end $$;
create function public.studio_story_episode_profile(p_episode uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select to_jsonb(p) from public.studio_series_production p join public.episodes e on e.id=p_episode and e.workspace_id=p.workspace_id
 where p.series_id=(e.briefing#>>'{story_context,series_id}')::uuid and p.profile_sha256=public.story_episode_profile_hash(e.id);
$$;


create or replace function public.studio_production_media_reserve(p_workspace uuid,p_actor uuid,p_series uuid,p_id uuid,p_character text,p_kind text,p_sha text,p_bytes int,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; prior public.studio_production_media; c jsonb; expected_voice text; object_path text;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('production-media-storage'));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_production_media where id=p_id;
 if found then
  if prior.series_id<>p_series or prior.workspace_id<>p_workspace or prior.character_id<>p_character or prior.kind<>p_kind or prior.sha256<>p_sha or prior.bytes<>p_bytes or prior.metadata<>p_metadata then raise insufficient_privilege; end if;
  return to_jsonb(prior);
 end if;
 select * into prior from public.studio_production_media where series_id=p_series and workspace_id=p_workspace and character_id=p_character
  and kind=p_kind and sha256=p_sha and bytes=p_bytes and metadata=p_metadata order by created_at,id limit 1;
 if found then return to_jsonb(prior); end if;
 if not public.story_pattern_editable(p_series) and (exists(select 1 from public.studio_series_production where series_id=p_series) or exists(select 1 from public.studio_story_chapters where series_id=p_series)) then raise check_violation using message='Configure identity before the first chapter'; end if;
 select v into c from jsonb_array_elements(s.bible->'cast') v where v->>'id'=p_character;
 if c is null or p_sha !~ '^[a-f0-9]{64}$' or p_bytes is null or p_metadata is null then raise check_violation; end if;
 if p_kind='reference' then
  if p_bytes not between 44 and 12582912 or p_metadata->>'mime' is distinct from 'image/png' or
   coalesce((p_metadata->>'width')::int,0) not between 480 and 4096 or coalesce((p_metadata->>'height')::int,0) not between 480 and 4096 or
   (p_metadata->>'width')::int>=(p_metadata->>'height')::int then raise check_violation; end if;
 elsif p_kind='voice_sample' then
  expected_voice:=case when c->>'voice'='female' then 'pt-BR-FranciscaNeural' else 'pt-BR-AntonioNeural' end;
  if p_bytes not between 44 and 524288 or p_metadata->>'mime' is distinct from 'audio/wav' or p_metadata->>'voice_id' is distinct from expected_voice or
   p_metadata->>'engine' is distinct from 'edge' or p_metadata->>'version' is distinct from 'edge-tts-7.2.8-rate0' or
   coalesce((p_metadata->>'seconds')::numeric,0) not between 0.1 and 12 then raise check_violation; end if;
 else raise check_violation; end if;
 if (select coalesce(sum(bytes),0) from public.studio_production_media)+p_bytes>134217728 or
  (select coalesce(sum(bytes),0) from public.studio_production_media where workspace_id=p_workspace)+p_bytes>67108864 or
  (p_kind='reference' and (select count(*) from public.studio_production_media where workspace_id=p_workspace and kind='reference' and created_at>now()-interval '24 hours')>=8) then raise check_violation using message='Production setup storage quota reached'; end if;
 object_path:=p_workspace||'/story-profile/'||p_series||'/'||p_id||'/'||p_sha||case when p_kind='reference' then '.png' else '.wav' end;
 insert into public.studio_production_media(id,series_id,workspace_id,character_id,kind,sha256,path,bytes,metadata)
 values(p_id,p_series,p_workspace,p_character,p_kind,p_sha,object_path,p_bytes,p_metadata) returning * into prior;
 return to_jsonb(prior);
end $$;

create or replace function public.studio_profile_voices_request(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; r public.studio_production_setup;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if (not public.story_pattern_editable(s.id) and (exists(select 1 from public.studio_series_production where series_id=s.id) or exists(select 1 from public.studio_story_chapters where series_id=s.id))) then return '{"code":"locked"}'; end if;
 if not coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"setup_required"}'; end if;
 insert into public.studio_production_setup(series_id,workspace_id,actor) values(s.id,p_workspace,p_actor) on conflict do nothing;
 select * into strict r from public.studio_production_setup where series_id=s.id for update;
 if r.voice_state='ready' then return '{"code":"ready"}'; end if;
 if r.dispatched_at>now()-interval '12 minutes' or r.lease_until>now() then return '{"code":"waiting"}'; end if;
 if r.attempts>=3 then return '{"code":"retry_exhausted"}'; end if;
 update public.studio_production_setup set voice_state='queued',attempts=attempts+1,dispatched_at=now() where series_id=s.id;
 return '{"code":"dispatch"}';
end $$;

create or replace function public.claim_profile_voices(p_series uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; r public.studio_production_setup;
begin
 select * into strict s from public.studio_series where id=p_series and archived_at is null for update;
 select * into strict r from public.studio_production_setup where series_id=s.id for update;
 if r.voice_state='ready' then return '{"code":"ready"}'; end if;
 if r.lease_until>now() or r.voice_state not in ('queued','working') then return '{"code":"waiting"}'; end if;
 if not coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false) or (not public.story_pattern_editable(s.id) and (exists(select 1 from public.studio_series_production where series_id=s.id) or exists(select 1 from public.studio_story_chapters where series_id=s.id))) then return '{"code":"locked"}'; end if;
 update public.studio_production_setup set voice_state='working',lease_token=p_token,lease_until=now()+interval '10 minutes' where series_id=s.id;
 return jsonb_build_object('code','claimed','workspace_id',s.workspace_id,'actor',r.actor,'bible',s.bible,
  'media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.studio_production_media m where m.series_id=s.id and m.kind='voice_sample' and m.ready));
end $$;

create or replace function public.mount_animated_chapter(p_episode uuid,p_origin text) returns jsonb
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
  and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid and profile_sha256=public.story_episode_profile_hash(ep.id);
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

create or replace function public.studio_animation_step(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; prep public.studio_animation_preparations; production public.studio_series_production; actor uuid;
 wallet uuid; observation jsonb; plan jsonb:='[]'; s jsonb; b jsonb; outcome jsonb;
 job public.studio_video_jobs; prior public.studio_animation_dispatches; action text; target uuid; n integer;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict production from public.studio_series_production where workspace_id=ep.workspace_id and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid and profile_sha256=public.story_episode_profile_hash(ep.id);
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

create function public.studio_story_pattern_view(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; pref public.studio_story_presentations; profile jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace;
 select * into strict pref from public.studio_story_presentations where series_id=s.id and revision=p_revision;
 if not (pref.preferences->'allowed_styles' ? p_style) then raise check_violation;end if;
 select p.profile into profile from public.studio_story_patterns b join public.studio_series_production p using(series_id,profile_sha256)
 where b.series_id=s.id and b.presentation_revision=p_revision and b.style_id=p_style;
 return jsonb_build_object('series_id',s.id,'bible',s.bible,'revision',p_revision,'style_id',p_style,'source',pref.preferences->>'source','profile',profile,
  'media',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'character_id',character_id,'kind',kind,'sha256',sha256,'metadata',metadata,'created_at',created_at) order by created_at,id),'[]') from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and ready),
  'can_configure',profile is null and public.story_pattern_editable(s.id) and p_revision=(select max(revision) from public.studio_story_presentations where series_id=s.id) and p_style in ('cinematic_3d','cartoon_2d','anime','realistic'),
  'voice_state',coalesce((select voice_state from public.studio_production_setup where series_id=s.id),'idle'),
  'voice_retry_allowed',coalesce((select attempts<3 and (dispatched_at is null or dispatched_at<=now()-interval '12 minutes') and (lease_until is null or lease_until<=now()) from public.studio_production_setup where series_id=s.id),true),
  'voice_attempts',coalesce((select attempts from public.studio_production_setup where series_id=s.id),0),
  'voice_enabled',coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false));
end $$;

create function public.studio_story_pattern_finalize(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text,p_profile jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; pref public.studio_story_presentations; prior public.studio_story_patterns; r jsonb; v jsonb; c jsonb; m public.studio_production_media; original jsonb; current_voices jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into strict pref from public.studio_story_presentations where series_id=s.id and revision=p_revision;
 select * into prior from public.studio_story_patterns where series_id=s.id and presentation_revision=p_revision and style_id=p_style;
 if found then
  if prior.profile_sha256=p_hash and exists(select 1 from public.studio_series_production where series_id=s.id and profile_sha256=p_hash and profile=p_profile) then return '{"code":"saved"}';end if;
  raise check_violation using message='Pattern already fixed';
 end if;
 if p_revision<>(select max(revision) from public.studio_story_presentations where series_id=s.id) then return '{"code":"style_changed"}';end if;
 if not public.story_pattern_editable(s.id) or not (pref.preferences->'allowed_styles' ? p_style) or p_style not in ('cinematic_3d','cartoon_2d','anime','realistic') then return '{"code":"locked"}';end if;
 if p_hash is null or p_profile is null or p_hash!~'^[a-f0-9]{64}$' or p_profile->>'version' is distinct from '1.0.0' or p_profile->>'orientation' is distinct from 'portrait' or
  p_profile->>'short_edge' is distinct from '704' or p_profile->>'output_fps' is distinct from '60' or coalesce(char_length(p_profile->>'style'),0) not between 30 and 3000 or
  jsonb_array_length(p_profile->'references') is distinct from jsonb_array_length(s.bible->'cast') or jsonb_array_length(p_profile->'voices') is distinct from jsonb_array_length(s.bible->'cast') then raise check_violation;end if;
 for c in select value from jsonb_array_elements(s.bible->'cast') loop
  select value into r from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id';
  select value into v from jsonb_array_elements(p_profile->'voices') where value->>'character_id'=c->>'id';
  if r is null or v is null or (select count(*) from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id')<>1 or
   (select count(*) from jsonb_array_elements(p_profile->'voices') where value->>'character_id'=c->>'id')<>1 then raise check_violation;end if;
  if not exists(select 1 from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and character_id=c->>'id' and kind='reference' and ready and path=r->>'path' and sha256=r->>'sha256') then raise check_violation;end if;
  select * into m from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and character_id=c->>'id' and kind='voice_sample' and ready and sha256=v->>'sample_sha256' limit 1;
  if not found or v->>'engine' is distinct from m.metadata->>'engine' or v->>'version' is distinct from m.metadata->>'version' or v->>'voice_id' is distinct from m.metadata->>'voice_id' then raise check_violation;end if;
 end loop;
 select p.profile into original from public.studio_chapter_productions b join public.studio_series_production p using(series_id,profile_sha256)
 where b.series_id=s.id order by b.chapter_number desc limit 1;
 if not found then select p.profile into original from public.studio_series_production p where p.series_id=s.id order by p.created_at,p.profile_sha256 limit 1;end if;
 if original is not null and pref.preferences->>'voice_policy'='preserve' then
  select jsonb_agg(x order by x->>'character_id') into original from jsonb_array_elements(original->'voices') x;
  select jsonb_agg(x order by x->>'character_id') into current_voices from jsonb_array_elements(p_profile->'voices') x;
  if original is distinct from current_voices then return '{"code":"voice_change_not_allowed"}';end if;
 end if;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256,legacy_identity) values(s.id,p_workspace,p_profile,p_hash,false) on conflict(series_id,profile_sha256) do nothing;
 if not exists(select 1 from public.studio_series_production where series_id=s.id and profile_sha256=p_hash and profile=p_profile and workspace_id=p_workspace) then raise check_violation;end if;
 insert into public.studio_story_patterns(series_id,presentation_revision,style_id,profile_sha256,created_by) values(s.id,p_revision,p_style,p_hash,p_actor);
 return '{"code":"saved"}';
end $$;

create or replace function public.studio_story_next_presented(p_workspace uuid,p_actor uuid,p_series uuid,p_style text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.studio_story_presentations; chosen text; result jsonb; prior public.studio_chapter_presentations; profile_hash text; prior_hash text;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege;end if;
 select * into pref from public.studio_story_presentations where series_id=p_series order by revision desc limit 1;
 if not found then
  if p_style is not null then return '{"code":"style_preferences_required"}';end if;
  result:=public.studio_story_next_before_presentation(p_workspace,p_actor,p_series);
 else
  chosen:=coalesce(p_style,pref.preferences->>'primary_style');
  if not (pref.preferences->'allowed_styles' ? chosen) then raise check_violation;end if;
  if chosen='illustrated' then
   if pref.preferences->>'source' not in ('automatic','local') or pref.preferences->>'voice_policy'<>'preserve' then return '{"code":"style_preparation_required"}';end if;
  else
   if chosen not in ('cinematic_3d','cartoon_2d','anime','realistic') or pref.preferences->>'source' not in ('automatic','modal') then return '{"code":"style_preparation_required"}';end if;
   select profile_sha256 into profile_hash from public.studio_story_patterns where series_id=p_series and presentation_revision=pref.revision and style_id=chosen;
   if not found then return '{"code":"profile_incomplete"}';end if;
   if not coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"animation_setup_required"}';end if;
  end if;
  -- This base function only reserves narrative work, not an illustrated render or GPU.
  result:=public.studio_story_next_illustrated(p_workspace,p_actor,p_series);
 end if;
 if result->>'code'='queued' then
  select * into prior from public.studio_chapter_presentations where series_id=p_series and chapter_number=(result->>'chapter_number')::int;
  if found then
   if prior.revision is distinct from pref.revision or prior.style_id is distinct from chosen then return '{"code":"existing_chapter_style"}';end if;
  else
   insert into public.studio_chapter_presentations(series_id,chapter_number,revision,style_id) values(p_series,(result->>'chapter_number')::int,pref.revision,chosen);
  end if;
  if profile_hash is not null then
   insert into public.studio_chapter_productions(series_id,chapter_number,profile_sha256) values(p_series,(result->>'chapter_number')::int,profile_hash) on conflict do nothing;
   select profile_sha256 into strict prior_hash from public.studio_chapter_productions where series_id=p_series and chapter_number=(result->>'chapter_number')::int;
   if prior_hash<>profile_hash then raise check_violation;end if;
  end if;
 end if;
 return result;
end $$;

alter function public.save_animation_draft(uuid,text,text,jsonb) rename to save_animation_draft_before_patterns;
revoke all on function public.save_animation_draft_before_patterns(uuid,text,text,jsonb) from service_role;
create function public.save_animation_draft(p_episode uuid,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.story_episode_profile_hash(p_episode) is distinct from p_profile then raise check_violation using message='Chapter profile mismatch';end if;
 return public.save_animation_draft_before_patterns(p_episode,p_profile,p_fingerprint,p_draft);
end $$;
alter function public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb) rename to studio_reserve_video_before_patterns;
revoke all on function public.studio_reserve_video_before_patterns(uuid,uuid,uuid,uuid,text,jsonb) from service_role;
create function public.studio_reserve_video(p_workspace uuid,p_actor uuid,p_request uuid,p_episode uuid,p_profile text,p_plan jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if not exists(select 1 from public.episodes where id=p_episode and workspace_id=p_workspace) then raise insufficient_privilege;end if;
 if public.story_episode_profile_hash(p_episode) is distinct from p_profile then raise check_violation using message='Chapter profile mismatch';end if;
 if exists(select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id join public.studio_chapter_presentations b using(series_id,chapter_number)
  join public.studio_story_presentations p on p.series_id=b.series_id and p.revision=b.revision where i.episode_id=p_episode and p.preferences->>'source'='modal') and
  exists(select 1 from jsonb_array_elements(p_plan) x where x->>'provider_id' is distinct from 'modal-wan-s2v-h100-v1') then raise check_violation using message='Pinned source mismatch';end if;
 return public.studio_reserve_video_before_patterns(p_workspace,p_actor,p_request,p_episode,p_profile,p_plan);
end $$;

-- Keep legacy configuration on its original single identity.
create or replace function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ep uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace for update;if not found then raise insufficient_privilege;end if;
 select i.episode_id into ep from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id where c.series_id=p_series order by c.chapter_number desc limit 1;
 if p_action='retry' and ep is not null and public.story_episode_profile_hash(ep) is not null then
  if not coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"animation_setup_required"}';end if;
  if exists(select 1 from public.studio_video_jobs where episode_id=ep) then return '{"code":"existing_video_work"}';end if;
 end if;
 return public.studio_story_manage_illustrated(p_workspace,p_actor,p_series,p_action);
end $$;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_patterns;
revoke all on function public.studio_video_overview_before_patterns(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; patterns jsonb;
begin
 result:=public.studio_video_overview_before_patterns(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('series_id',p.series_id,'revision',p.presentation_revision,'style_id',p.style_id,'profile_sha256',p.profile_sha256) order by p.created_at),'[]') into patterns
 from public.studio_story_patterns p join public.studio_series s on s.id=p.series_id where s.workspace_id=p_workspace;
 return result||jsonb_build_object('patterns',patterns);
end $$;

revoke all on function public.story_pattern_editable(uuid),public.story_episode_profile_hash(uuid),public.studio_story_episode_profile(uuid),public.studio_story_pattern_view(uuid,uuid,uuid,int,text),public.studio_story_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text),public.save_animation_draft(uuid,text,text,jsonb),public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_episode_profile(uuid),public.studio_story_pattern_view(uuid,uuid,uuid,int,text),public.studio_story_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text),public.save_animation_draft(uuid,text,text,jsonb),public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb),public.studio_video_overview(uuid,uuid) to service_role;

create or replace function public.studio_production_setup_view(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; media jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'character_id',character_id,'kind',kind,'sha256',sha256,'metadata',metadata,'created_at',created_at) order by created_at,id),'[]') into media
 from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and ready;
 return jsonb_build_object('series_id',s.id,'bible',s.bible,'media',media,
  'profile',(select profile from public.studio_series_production where series_id=s.id and legacy_identity),
  'can_configure',s.archived_at is null and not exists(select 1 from public.studio_story_chapters where series_id=s.id) and not exists(select 1 from public.studio_series_production where series_id=s.id),
  'voice_state',coalesce((select voice_state from public.studio_production_setup where series_id=s.id),'idle'),
  'voice_retry_allowed',coalesce((select attempts<3 and (dispatched_at is null or dispatched_at<=now()-interval '12 minutes') and (lease_until is null or lease_until<=now()) from public.studio_production_setup where series_id=s.id),true),
  'voice_attempts',coalesce((select attempts from public.studio_production_setup where series_id=s.id),0),
  'voice_enabled',coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false));
end $$;
