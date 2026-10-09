-- Persist draft and individual PCM checkpoints independently of any GPU reservation.
create table public.studio_animation_preparations (
 episode_id uuid primary key references public.episodes(id), workspace_id uuid not null references public.studio_workspaces(id),
 profile_sha256 text not null check(profile_sha256~'^[a-f0-9]{64}$'),
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'), context jsonb not null, draft jsonb not null,
 lease_token uuid, lease_until timestamptz, completed_at timestamptz, created_at timestamptz not null default now()
);
create table public.studio_animation_audio (
 episode_id uuid not null references public.studio_animation_preparations(episode_id), shot_id text not null check(shot_id~'^take_[0-7]$'),
 binding jsonb not null, created_at timestamptz not null default now(), primary key(episode_id,shot_id)
);
alter table public.studio_animation_preparations enable row level security;
alter table public.studio_animation_audio enable row level security;
revoke all on public.studio_animation_preparations,public.studio_animation_audio from public,anon,authenticated;
grant all on public.studio_animation_preparations,public.studio_animation_audio to service_role;

create function public.guard_animation_preparation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or row(new.episode_id,new.workspace_id,new.profile_sha256,new.fingerprint,new.context,new.draft,new.created_at)
  is distinct from row(old.episode_id,old.workspace_id,old.profile_sha256,old.fingerprint,old.context,old.draft,old.created_at) then raise check_violation; end if;
 return new;
end $$;
create trigger studio_animation_preparation_immutable before update or delete on public.studio_animation_preparations for each row execute function public.guard_animation_preparation();
create function public.guard_animation_audio() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise check_violation using message='Prepared PCM checkpoint is immutable'; end $$;
create trigger studio_animation_audio_immutable before update or delete on public.studio_animation_audio for each row execute function public.guard_animation_audio();
revoke all on function public.guard_animation_preparation(),public.guard_animation_audio() from public,anon,authenticated;

create function public.save_animation_draft(p_episode uuid,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; prior public.studio_animation_preparations;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into prior from public.studio_animation_preparations where episode_id=p_episode;
 if found then
  if prior.fingerprint is distinct from p_fingerprint or prior.draft is distinct from p_draft or prior.profile_sha256 is distinct from p_profile then raise check_violation; end if;
  return '{"code":"saved"}';
 end if;
 if ep.status<>'research' or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or
  jsonb_typeof(p_draft->'scenes') is distinct from 'array' or jsonb_array_length(p_draft->'scenes') not between 5 and 8 or
  not exists(select 1 from public.studio_series_production where workspace_id=ep.workspace_id
   and series_id=(ep.briefing#>>'{story_context,series_id}')::uuid and profile_sha256=p_profile) then raise check_violation; end if;
 insert into public.studio_animation_preparations(episode_id,workspace_id,profile_sha256,fingerprint,context,draft)
 values(p_episode,ep.workspace_id,p_profile,p_fingerprint,ep.briefing->'story_context',p_draft);
 return '{"code":"saved"}';
end $$;
create function public.claim_animation_preparation(p_episode uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; r public.studio_animation_preparations;
begin
 if p_token is null then raise insufficient_privilege; end if;
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animation_preparations where episode_id=p_episode for update;
 if r.completed_at is not null then return '{"code":"completed"}'; end if;
 if ep.status<>'research' or ep.briefing->'story_context' is distinct from r.context then raise check_violation; end if;
 if r.lease_until>now() and r.lease_token is distinct from p_token then return '{"code":"busy"}'; end if;
 update public.studio_animation_preparations set lease_token=p_token,lease_until=now()+interval '15 minutes' where episode_id=p_episode;
 return jsonb_build_object('code','claimed','preparation',to_jsonb(r),'audio',
  (select coalesce(jsonb_agg(binding order by shot_id),'[]') from public.studio_animation_audio where episode_id=p_episode));
end $$;

create function public.save_animation_audio(p_episode uuid,p_token uuid,p_binding jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_animation_preparations; ep public.episodes; profile jsonb; scene jsonb; i integer; prior jsonb; expected_path text;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animation_preparations where episode_id=p_episode for update;
 if p_token is null or r.lease_token is distinct from p_token or coalesce(r.lease_until,'-infinity')<=now() or r.completed_at is not null then raise insufficient_privilege; end if;
 if ep.status<>'research' or ep.briefing->'story_context' is distinct from r.context then raise check_violation; end if;
 select p.profile into strict profile from public.studio_series_production p where p.workspace_id=ep.workspace_id
  and p.series_id=(r.context->>'series_id')::uuid and p.profile_sha256=r.profile_sha256;
 if p_binding->>'shot_id' is null or p_binding->>'shot_id'!~'^take_[0-7]$' then raise check_violation; end if;
 i:=substring(p_binding->>'shot_id' from 6)::integer; scene:=r.draft->'scenes'->i;
 expected_path:=r.workspace_id||'/story-audio/'||r.episode_id||'/'||r.fingerprint||'/'||(p_binding->>'shot_id')||'/'||(p_binding->>'audio_sha256')||'.wav';
 if scene is null or p_binding->>'character_id' is distinct from scene#>>'{visual,speaker_id}' or
  scene#>'{visual,on_stage}' is distinct from jsonb_build_array(p_binding->>'character_id') or
  p_binding->>'audio_sha256' is null or p_binding->>'audio_sha256'!~'^[a-f0-9]{64}$' or p_binding->>'audio_path' is distinct from expected_path or
  coalesce((p_binding->>'audio_seconds')::numeric,0) not between 0.0000625 and 3.9375 or
  p_binding->>'prompt' is distinct from scene->>'prompt' or p_binding->>'seed' is distinct from scene->>'seed' or
  not exists(select 1 from jsonb_array_elements(profile->'references') v where v->>'character_id'=p_binding->>'character_id'
   and v->>'path'=p_binding->>'reference_path' and v->>'sha256'=p_binding->>'reference_sha256') or
  not exists(select 1 from jsonb_array_elements(profile->'voices') v where v->>'character_id'=p_binding->>'character_id'
   and public.studio_voice_sha256(v)=p_binding->>'voice_sha256') then raise check_violation; end if;
 select binding into prior from public.studio_animation_audio where episode_id=p_episode and shot_id=p_binding->>'shot_id';
 if found then if prior is distinct from p_binding then raise check_violation; end if; return '{"code":"saved"}'; end if;
 insert into public.studio_animation_audio(episode_id,shot_id,binding) values(p_episode,p_binding->>'shot_id',p_binding);
 return '{"code":"saved"}';
end $$;

create function public.complete_animation_preparation(p_episode uuid,p_token uuid,p_fingerprint text,p_script jsonb,p_hash text,p_quality jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; r public.studio_animation_preparations; s jsonb; binding jsonb; draft_scene jsonb; n integer;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animation_preparations where episode_id=p_episode for update;
 if p_token is null or r.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if r.completed_at is not null then
  if ep.script_json is distinct from p_script or ep.script_hash is distinct from p_hash then raise check_violation; end if;
  return '{"code":"saved"}';
 end if;
 n:=jsonb_array_length(r.draft->'scenes');
 if coalesce(r.lease_until,'-infinity')<=now() or ep.status<>'research' or ep.briefing->'story_context' is distinct from r.context or
  p_fingerprint is distinct from r.fingerprint or p_script->>'episode_id' is distinct from p_episode::text or
  p_script#>'{fiction,context}' is distinct from r.context or p_script#>>'{fiction,summary}' is distinct from r.draft->>'summary' or
  p_script#>>'{fiction,animation,profile_sha256}' is distinct from r.profile_sha256 or
  p_script#>'{fiction,animation}' is distinct from jsonb_build_object('version','1.0.0','profile_sha256',r.profile_sha256,
   'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237) or
  p_script->>'gap_seconds' is distinct from '0' or p_script->'music' is distinct from 'null'::jsonb or p_script ? 'platform_ctas' or
  p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_quality->>'passed' is distinct from 'true' or
  jsonb_array_length(p_script->'scenes') is distinct from n or
  (select count(*) from public.studio_animation_audio where episode_id=p_episode)<>n then raise check_violation; end if;
 for s in select value from jsonb_array_elements(p_script->'scenes') loop
  select a.binding into strict binding from public.studio_animation_audio a where a.episode_id=p_episode and a.shot_id=s->>'id';
  draft_scene:=r.draft->'scenes'->((s->>'order')::integer);
  if s->'animation' is distinct from binding or s->>'id' is distinct from 'take_'||(s->>'order') or
   s->>'narration_text' is distinct from draft_scene->>'narration_text' or s->'story_visual' is distinct from draft_scene->'visual' or
   s->>'duration_seconds' is distinct from '3.95' or s->>'transition' is distinct from 'cut' or s->>'ken_burns' is distinct from 'static' or
   s->'asset_portrait' is distinct from 'null'::jsonb or s->'asset_landscape' is distinct from 'null'::jsonb then raise check_violation; end if;
 end loop;
 update public.episodes set status='script',script_json=p_script,script_hash=p_hash,prompt_version=p_script->>'prompt_version',
  metadata=(coalesce(metadata,'{}')-'animation_preparation_error')||jsonb_build_object('script_qa',p_quality,'animation_preparation',jsonb_build_object('fingerprint',r.fingerprint,'completed_at',now())) where id=p_episode;
 update public.studio_animation_preparations set completed_at=now(),lease_until=null where episode_id=p_episode;
 return '{"code":"prepared"}';
end $$;
revoke all on function public.save_animation_draft(uuid,text,text,jsonb),public.claim_animation_preparation(uuid,uuid),
 public.save_animation_audio(uuid,uuid,jsonb),public.complete_animation_preparation(uuid,uuid,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_animation_draft(uuid,text,text,jsonb),public.claim_animation_preparation(uuid,uuid),
 public.save_animation_audio(uuid,uuid,jsonb),public.complete_animation_preparation(uuid,uuid,text,jsonb,text,jsonb) to service_role;

create function public.fail_animation_preparation(p_episode uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep public.episodes; r public.studio_animation_preparations;
begin
 select * into strict ep from public.episodes where id=p_episode for update;
 select * into strict r from public.studio_animation_preparations where episode_id=p_episode for update;
 if p_token is null or r.lease_token is distinct from p_token then raise insufficient_privilege; end if;
 if r.completed_at is not null then return '{"code":"already_prepared"}'; end if;
 if coalesce(r.lease_until,'-infinity')<=now() then raise insufficient_privilege; end if;
 if ep.status='research' then
  update public.episodes set metadata=coalesce(metadata,'{}')||jsonb_build_object('animation_preparation_error',
   'O preparo foi interrompido. Confira conexão, áudio, duração máxima de cada fala, referências e voz cadastrada. Nenhuma GPU foi solicitada.') where id=p_episode;
  update public.studio_animation_preparations set lease_until=null where episode_id=p_episode;
 end if;
 return '{"code":"interrupted","checkpoints_preserved":true}';
end $$;
revoke all on function public.fail_animation_preparation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_animation_preparation(uuid,uuid) to service_role;
