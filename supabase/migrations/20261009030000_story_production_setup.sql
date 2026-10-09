-- Private, member-scoped identity setup. Saving identity never qualifies a GPU provider.
create table public.studio_production_media (
 id uuid primary key, series_id uuid not null, workspace_id uuid not null,
 character_id text not null, kind text not null check(kind in ('reference','voice_sample')),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'), path text not null unique,
 bytes int not null check(bytes between 44 and 12582912), metadata jsonb not null,
 ready boolean not null default false, created_at timestamptz not null default now(),
 foreign key(series_id,workspace_id) references public.studio_series(id,workspace_id)
);
create table public.studio_production_setup (
 series_id uuid primary key, workspace_id uuid not null, actor uuid not null,
 voice_state text not null default 'idle' check(voice_state in ('idle','queued','working','ready','failed')),
 attempts int not null default 0 check(attempts between 0 and 3), dispatched_at timestamptz,
 lease_token uuid, lease_until timestamptz,
 foreign key(series_id,workspace_id) references public.studio_series(id,workspace_id)
);
alter table public.studio_production_media enable row level security;
alter table public.studio_production_setup enable row level security;
grant all on public.studio_production_media,public.studio_production_setup to service_role;

create function public.guard_production_media() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or old.ready or (to_jsonb(new)-'ready') is distinct from (to_jsonb(old)-'ready') then
  raise check_violation using message='Production media identity is immutable';
 end if; return new;
end $$;
create trigger studio_production_media_immutable before update or delete on public.studio_production_media for each row execute function public.guard_production_media();

create function public.studio_production_setup_view(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; media jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'character_id',character_id,'kind',kind,'sha256',sha256,'metadata',metadata,'created_at',created_at) order by created_at,id),'[]') into media
 from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and ready;
 return jsonb_build_object('series_id',s.id,'bible',s.bible,'media',media,
  'profile',(select profile from public.studio_series_production where series_id=s.id),
  'can_configure',s.archived_at is null and not exists(select 1 from public.studio_story_chapters where series_id=s.id) and not exists(select 1 from public.studio_series_production where series_id=s.id),
  'voice_state',coalesce((select voice_state from public.studio_production_setup where series_id=s.id),'idle'),
  'voice_retry_allowed',coalesce((select attempts<3 and (dispatched_at is null or dispatched_at<=now()-interval '12 minutes') and (lease_until is null or lease_until<=now()) from public.studio_production_setup where series_id=s.id),true),
  'voice_attempts',coalesce((select attempts from public.studio_production_setup where series_id=s.id),0),
  'voice_enabled',coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false));
end $$;

-- Reserve storage before uploading. Unknown upload outcomes retain their reservation.
create function public.studio_production_media_reserve(p_workspace uuid,p_actor uuid,p_series uuid,p_id uuid,p_character text,p_kind text,p_sha text,p_bytes int,p_metadata jsonb) returns jsonb
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
 if exists(select 1 from public.studio_series_production where series_id=p_series) or exists(select 1 from public.studio_story_chapters where series_id=p_series) then raise check_violation using message='Configure identity before the first chapter'; end if;
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

create function public.studio_production_media_ready(p_workspace uuid,p_actor uuid,p_id uuid,p_sha text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.studio_production_media where id=p_id and workspace_id=p_workspace and sha256=p_sha;
 if not found then raise insufficient_privilege; end if;
 update public.studio_production_media set ready=true where id=p_id and not ready;
end $$;

create function public.studio_production_media_read(p_workspace uuid,p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_production_media;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict r from public.studio_production_media where id=p_id and workspace_id=p_workspace and ready;
 return to_jsonb(r);
end $$;

create function public.studio_profile_voices_request(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; r public.studio_production_setup;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if exists(select 1 from public.studio_series_production where series_id=s.id) or exists(select 1 from public.studio_story_chapters where series_id=s.id) then return '{"code":"locked"}'; end if;
 if not coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"setup_required"}'; end if;
 insert into public.studio_production_setup(series_id,workspace_id,actor) values(s.id,p_workspace,p_actor) on conflict do nothing;
 select * into strict r from public.studio_production_setup where series_id=s.id for update;
 if r.voice_state='ready' then return '{"code":"ready"}'; end if;
 if r.dispatched_at>now()-interval '12 minutes' or r.lease_until>now() then return '{"code":"waiting"}'; end if;
 if r.attempts>=3 then return '{"code":"retry_exhausted"}'; end if;
 update public.studio_production_setup set voice_state='queued',attempts=attempts+1,dispatched_at=now() where series_id=s.id;
 return '{"code":"dispatch"}';
end $$;

create function public.claim_profile_voices(p_series uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; r public.studio_production_setup;
begin
 select * into strict s from public.studio_series where id=p_series and archived_at is null for update;
 select * into strict r from public.studio_production_setup where series_id=s.id for update;
 if r.voice_state='ready' then return '{"code":"ready"}'; end if;
 if r.lease_until>now() or r.voice_state not in ('queued','working') then return '{"code":"waiting"}'; end if;
 if not coalesce((select value->>'profile_voices_enabled'='true' from public.system_config where key='story_production'),false) or exists(select 1 from public.studio_series_production where series_id=s.id) or exists(select 1 from public.studio_story_chapters where series_id=s.id) then return '{"code":"locked"}'; end if;
 update public.studio_production_setup set voice_state='working',lease_token=p_token,lease_until=now()+interval '10 minutes' where series_id=s.id;
 return jsonb_build_object('code','claimed','workspace_id',s.workspace_id,'actor',r.actor,'bible',s.bible,
  'media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.studio_production_media m where m.series_id=s.id and m.kind='voice_sample' and m.ready));
end $$;

create function public.finish_profile_voices(p_series uuid,p_token uuid,p_success boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_production_setup; complete boolean;
begin
 select * into strict r from public.studio_production_setup where series_id=p_series for update;
 if r.lease_token is distinct from p_token then return '{"code":"stale"}'; end if;
 select not exists(select 1 from public.studio_series s cross join jsonb_array_elements(s.bible->'cast') c where s.id=p_series and
  not exists(select 1 from public.studio_production_media m where m.series_id=s.id and m.character_id=c->>'id' and m.kind='voice_sample' and m.ready)) into complete;
 update public.studio_production_setup set voice_state=case when p_success and complete then 'ready' else 'failed' end,lease_token=null,lease_until=null where series_id=p_series;
 return jsonb_build_object('code',case when p_success and complete then 'ready' else 'failed' end);
end $$;

create function public.studio_production_finalize(p_workspace uuid,p_actor uuid,p_series uuid,p_profile jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; r jsonb; v jsonb; c jsonb; m public.studio_production_media;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if exists(select 1 from public.studio_series_production where series_id=s.id) then
  if exists(select 1 from public.studio_series_production where series_id=s.id and profile=p_profile and profile_sha256=p_hash) then return '{"code":"saved"}'; end if;
  raise check_violation using message='Identity already fixed';
 end if;
 if exists(select 1 from public.studio_story_chapters where series_id=s.id) then raise check_violation using message='Cannot change a started story'; end if;
 if p_hash is null or p_profile is null or not (p_profile ?& array['version','orientation','short_edge','output_fps','style','references','voices']) or p_hash !~ '^[a-f0-9]{64}$' or p_profile->>'version' is distinct from '1.0.0' or p_profile->>'orientation' is distinct from 'portrait' or
  p_profile->>'short_edge' is distinct from '704' or p_profile->>'output_fps' is distinct from '60' or coalesce(char_length(p_profile->>'style'),0) not between 30 and 3000 or
  jsonb_array_length(p_profile->'references')<>jsonb_array_length(s.bible->'cast') or jsonb_array_length(p_profile->'voices')<>jsonb_array_length(s.bible->'cast') then raise check_violation; end if;
 for c in select value from jsonb_array_elements(s.bible->'cast') loop
  select value into r from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id';
  select value into v from jsonb_array_elements(p_profile->'voices') where value->>'character_id'=c->>'id';
  if r is null or v is null or
   (select count(*) from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id')<>1 or
   (select count(*) from jsonb_array_elements(p_profile->'voices') where value->>'character_id'=c->>'id')<>1 then raise check_violation; end if;
  if not exists(select 1 from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and character_id=c->>'id' and kind='reference' and ready and path=r->>'path' and sha256=r->>'sha256') then raise check_violation; end if;
  select * into m from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and character_id=c->>'id' and kind='voice_sample' and ready and sha256=v->>'sample_sha256' limit 1;
  if not found or v->>'engine' is distinct from m.metadata->>'engine' or v->>'version' is distinct from m.metadata->>'version' or v->>'voice_id' is distinct from m.metadata->>'voice_id' then raise check_violation; end if;
 end loop;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(s.id,p_workspace,p_profile,p_hash);
 return '{"code":"saved"}';
end $$;

-- Serialize the existing chapter gate with finalization; a partially configured draft
-- must not accidentally start the illustrated branch while the user expects animation.
alter function public.studio_story_next(uuid,uuid,uuid) rename to studio_story_next_before_setup;
revoke all on function public.studio_story_next_before_setup(uuid,uuid,uuid) from service_role;
create function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege; end if;
 if not exists(select 1 from public.studio_series_production where series_id=p_series) and
  (exists(select 1 from public.studio_production_media where series_id=p_series) or exists(select 1 from public.studio_production_setup where series_id=p_series)) then return '{"code":"profile_incomplete"}'; end if;
 return public.studio_story_next_before_setup(p_workspace,p_actor,p_series);
end $$;

revoke all on function public.guard_production_media(),public.studio_production_setup_view(uuid,uuid,uuid),public.studio_production_media_reserve(uuid,uuid,uuid,uuid,text,text,text,int,jsonb),public.studio_production_media_ready(uuid,uuid,uuid,text),public.studio_production_media_read(uuid,uuid,uuid),public.studio_profile_voices_request(uuid,uuid,uuid),public.claim_profile_voices(uuid,uuid),public.finish_profile_voices(uuid,uuid,boolean),public.studio_production_finalize(uuid,uuid,uuid,jsonb,text),public.studio_story_next(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_production_setup_view(uuid,uuid,uuid),public.studio_production_media_reserve(uuid,uuid,uuid,uuid,text,text,text,int,jsonb),public.studio_production_media_ready(uuid,uuid,uuid,text),public.studio_production_media_read(uuid,uuid,uuid),public.studio_profile_voices_request(uuid,uuid,uuid),public.claim_profile_voices(uuid,uuid),public.finish_profile_voices(uuid,uuid,boolean),public.studio_production_finalize(uuid,uuid,uuid,jsonb,text),public.studio_story_next(uuid,uuid,uuid) to service_role;
