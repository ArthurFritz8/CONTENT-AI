-- Explicit creative preferences are versioned independently of production approval.
create function public.valid_story_presentation(p jsonb) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['version','primary_style','continuity_mode','allowed_styles','source','voice_policy']) then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>6 or p->>'version' is distinct from '1.0.0' or
  coalesce(p->>'primary_style','') not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic') or
  coalesce(p->>'continuity_mode','') not in ('fixed','per_chapter') or coalesce(p->>'source','') not in ('automatic','modal','auray','local') or
  coalesce(p->>'voice_policy','') not in ('preserve','approved_variants') or jsonb_typeof(p->'allowed_styles') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'allowed_styles') not between 1 and 6 or not((p->'allowed_styles') ? (p->>'primary_style')) or
  (p->>'continuity_mode'='fixed' and jsonb_array_length(p->'allowed_styles')<>1) or
  exists(select 1 from jsonb_array_elements_text(p->'allowed_styles') s where s not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic')) or
  (select count(distinct s) from jsonb_array_elements_text(p->'allowed_styles') s)<>jsonb_array_length(p->'allowed_styles') then return false; end if;
 return true;
end $$;
create table public.studio_story_presentations (
 series_id uuid not null, workspace_id uuid not null, revision int not null check(revision between 1 and 100),
 effective_from int not null check(effective_from between 1 and 6), preferences jsonb not null check(public.valid_story_presentation(preferences)),
 request_id uuid not null unique, created_by uuid not null, created_at timestamptz not null default now(),
 primary key(series_id,revision), foreign key(series_id,workspace_id) references public.studio_series(id,workspace_id)
);
create table public.studio_chapter_presentations (
 series_id uuid not null, chapter_number int not null, revision int,
 style_id text check(style_id in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic')),
 primary key(series_id,chapter_number), foreign key(series_id,chapter_number) references public.studio_story_chapters(series_id,chapter_number),
 foreign key(series_id,revision) references public.studio_story_presentations(series_id,revision),
 check((revision is null)=(style_id is null))
);
create function public.guard_story_style_history() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or new is distinct from old then raise check_violation using message='Style history is immutable'; end if;return new;
end $$;
create trigger story_presentations_immutable before update or delete on public.studio_story_presentations for each row execute function public.guard_story_style_history();
create trigger chapter_presentations_immutable before update or delete on public.studio_chapter_presentations for each row execute function public.guard_story_style_history();
alter table public.studio_story_presentations enable row level security;
alter table public.studio_chapter_presentations enable row level security;
revoke all on public.studio_story_presentations,public.studio_chapter_presentations from public,anon,authenticated;
grant all on public.studio_story_presentations,public.studio_chapter_presentations to service_role;

alter function public.studio_story_save(uuid,uuid,uuid,jsonb) rename to studio_story_save_before_presentation;
revoke all on function public.studio_story_save_before_presentation(uuid,uuid,uuid,jsonb) from service_role;
create function public.studio_story_save(p_workspace uuid,p_actor uuid,p_request uuid,p_bible jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; pref jsonb;
begin
 sid:=public.studio_story_save_before_presentation(p_workspace,p_actor,p_request,p_bible);
 select input->'presentation' into pref from public.studio_story_proposals where request_id=p_request;
 if pref is not null then
  if not public.valid_story_presentation(pref) then raise check_violation; end if;
  insert into public.studio_story_presentations(series_id,workspace_id,revision,effective_from,preferences,request_id,created_by)
   values(sid,p_workspace,1,1,pref,p_request,p_actor) on conflict(request_id) do nothing;
  if not exists(select 1 from public.studio_story_presentations where series_id=sid and request_id=p_request and preferences=pref and created_by=p_actor) then raise insufficient_privilege; end if;
 end if;
 return sid;
end $$;

create function public.studio_story_presentation_save(p_workspace uuid,p_actor uuid,p_series uuid,p_expected int,p_request uuid,p_preferences jsonb,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; prior public.studio_story_presentations; latest int; next_n int; ch public.studio_story_chapters; ep public.episodes; idea public.idea_queue;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_confirmed is distinct from true or p_expected is null or p_request is null or not public.valid_story_presentation(p_preferences) then raise check_violation; end if;
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_story_presentations where request_id=p_request;
 if found then
  if prior.series_id<>p_series or prior.workspace_id<>p_workspace or prior.created_by<>p_actor or prior.preferences<>p_preferences or prior.revision<>p_expected+1 then raise insufficient_privilege; end if;
  return jsonb_build_object('code','saved','revision',prior.revision,'effective_from',prior.effective_from);
 end if;
 select coalesce(max(revision),0) into latest from public.studio_story_presentations where series_id=p_series;
 if latest<>p_expected then return '{"code":"style_changed"}'; end if;
 select * into ch from public.studio_story_chapters where series_id=p_series order by chapter_number desc limit 1;
 next_n:=1;
 if found then
  select * into strict idea from public.idea_queue where id=ch.idea_id;
  select * into ep from public.episodes where id=idea.episode_id;
  if idea.status='pending' or ep.id is null or ep.status in ('idea','research','script','assets','rendered','failed') or not exists(select 1 from public.review_requests where episode_id=ep.id and decision='approved' and fingerprint=public.review_fingerprint(ep)) then
   return '{"code":"chapter_active"}';
  end if;
  next_n:=ch.chapter_number+1;
 end if;
 if next_n>jsonb_array_length(s.bible->'chapters') then return '{"code":"completed"}'; end if;
 if latest>=100 then return '{"code":"version_limit"}'; end if;
 insert into public.studio_story_presentations(series_id,workspace_id,revision,effective_from,preferences,request_id,created_by)
  values(p_series,p_workspace,latest+1,next_n,p_preferences,p_request,p_actor);
 return jsonb_build_object('code','saved','revision',latest+1,'effective_from',next_n);
end $$;

alter function public.studio_story_next(uuid,uuid,uuid) rename to studio_story_next_before_presentation;
revoke all on function public.studio_story_next_before_presentation(uuid,uuid,uuid) from service_role;
create function public.studio_story_next_presented(p_workspace uuid,p_actor uuid,p_series uuid,p_style text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare pref public.studio_story_presentations; chosen text; result jsonb; prior public.studio_chapter_presentations;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege; end if;
 select * into pref from public.studio_story_presentations where series_id=p_series order by revision desc limit 1;
 if found then
  chosen:=coalesce(p_style,pref.preferences->>'primary_style');
  if not ((pref.preferences->'allowed_styles') ? chosen) then raise check_violation; end if;
  -- A style choice never authorizes a production adapter or replaces the old profile.
  if chosen<>'illustrated' or pref.preferences->>'source' not in ('automatic','local') or pref.preferences->>'voice_policy'<>'preserve' or
   exists(select 1 from public.studio_series_production where series_id=p_series) then
   return jsonb_build_object('code','style_preparation_required','style_id',chosen);
  end if;
 elsif p_style is not null then return '{"code":"style_preferences_required"}';
 end if;
 result:=public.studio_story_next_before_presentation(p_workspace,p_actor,p_series);
 if result->>'code'='queued' then
  select * into prior from public.studio_chapter_presentations where series_id=p_series and chapter_number=(result->>'chapter_number')::int;
  if found then
   if prior.revision is distinct from pref.revision or prior.style_id is distinct from chosen then return '{"code":"existing_chapter_style"}'; end if;
  else
   insert into public.studio_chapter_presentations(series_id,chapter_number,revision,style_id) values(p_series,(result->>'chapter_number')::int,pref.revision,chosen);
  end if;
 end if;
 return result;
end $$;
create function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$ select public.studio_story_next_presented(p_workspace,p_actor,p_series,null) $$;

alter function public.studio_story_overview(uuid,uuid) rename to studio_story_overview_before_presentation;
revoke all on function public.studio_story_overview_before_presentation(uuid,uuid) from service_role;
create function public.studio_story_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; series jsonb;
begin
 result:=public.studio_story_overview_before_presentation(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||jsonb_build_object(
  'presentation',(select jsonb_build_object('revision',revision,'effective_from',effective_from,'preferences',preferences) from public.studio_story_presentations where series_id=(v->>'id')::uuid order by revision desc limit 1),
  'presentation_history',(select coalesce(jsonb_agg(jsonb_build_object('revision',revision,'effective_from',effective_from,'preferences',preferences) order by revision),'[]') from public.studio_story_presentations where series_id=(v->>'id')::uuid),
  'chapters',(select coalesce(jsonb_agg(c||jsonb_build_object('style_id',b.style_id,'presentation_revision',b.revision) order by (c->>'number')::int),'[]') from jsonb_array_elements(v->'chapters') c left join public.studio_chapter_presentations b on b.series_id=(v->>'id')::uuid and b.chapter_number=(c->>'number')::int)
 ) order by v->>'created_at' desc),'[]') into series from jsonb_array_elements(result->'series') v;
 return jsonb_set(result,'{series}',series);
end $$;

create table public.studio_story_style_samples (
 id uuid primary key,workspace_id uuid not null references public.studio_workspaces(id),
 sample jsonb not null,path text not null unique,ready boolean not null default false,created_at timestamptz not null default now(),
 check(sample->>'id'=id::text),check(sample->>'sha256'~'^[a-f0-9]{64}$'),
 check(path=workspace_id||'/story-samples/'||id||'/'||(sample->>'sha256')||'.mp4')
);
alter table public.studio_story_style_samples enable row level security;
revoke all on public.studio_story_style_samples from public,anon,authenticated;
grant all on public.studio_story_style_samples to service_role;
create trigger style_samples_immutable before update or delete on public.studio_story_style_samples for each row execute function public.guard_production_media();

create function public.register_story_style_sample(p_workspace uuid,p_sample jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.studio_story_style_samples; sid uuid:=(p_sample->>'id')::uuid; target text;
begin
 if sid is null or jsonb_typeof(p_sample) is distinct from 'object' or not(p_sample ?& array['id','style_id','source','title','model','sha256','bytes','seconds','width','height','output_fps','native_fps','has_audio','motion','review_scope','limitations']) or coalesce(p_sample->>'source','') not in ('modal','auray','local') or
  coalesce(p_sample->>'style_id','') not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic') or
  p_sample->>'sha256' is null or p_sample->>'sha256'!~'^[a-f0-9]{64}$' or
  coalesce((p_sample->>'bytes')::bigint,0) not between 1 and 52428800 or coalesce((p_sample->>'seconds')::numeric,0) not between 1 and 120 or
  coalesce((p_sample->>'width')::int,0) not between 480 and 4096 or coalesce((p_sample->>'height')::int,0) not between 480 and 4096 or
  coalesce((p_sample->>'output_fps')::numeric,0) not between 1 and 120 or coalesce(p_sample->>'motion','') not in ('generated','interpolated','mixed','illustrated') or
  coalesce(p_sample->>'review_scope','') not in ('reviewed_sample','technical_only') or jsonb_typeof(p_sample->'limitations') is distinct from 'array' then raise check_violation; end if;
 if (select count(*) from jsonb_object_keys(p_sample))<>16 or coalesce(char_length(p_sample->>'title'),0) not between 5 and 100 or coalesce(char_length(p_sample->>'model'),0) not between 2 and 120 or
  (p_sample->>'native_fps' is not null and (p_sample->>'native_fps')::numeric not between 1 and 120) or jsonb_typeof(p_sample->'has_audio') is distinct from 'boolean' or
  jsonb_array_length(p_sample->'limitations') not between 1 and 8 or exists(select 1 from jsonb_array_elements_text(p_sample->'limitations') x where char_length(x) not between 5 and 500) then raise check_violation; end if;
 target:=p_workspace||'/story-samples/'||sid||'/'||(p_sample->>'sha256')||'.mp4';
 insert into public.studio_story_style_samples(id,workspace_id,sample,path) values(sid,p_workspace,p_sample,target) on conflict(id) do nothing;
 select * into strict result from public.studio_story_style_samples where id=sid;
 if result.workspace_id<>p_workspace or result.sample<>p_sample then raise insufficient_privilege; end if;
 return jsonb_build_object('id',sid,'path',target,'ready',result.ready);
end $$;
create function public.ready_story_style_sample(p_workspace uuid,p_id uuid,p_sha text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.studio_story_style_samples where id=p_id and workspace_id=p_workspace and sample->>'sha256'=p_sha;
 if not found then raise insufficient_privilege; end if;
 update public.studio_story_style_samples set ready=true where id=p_id and not ready;
end $$;
create function public.studio_story_style_gallery(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 return (select coalesce(jsonb_agg((sample-'bytes'-'sha256')||jsonb_build_object('created_at',created_at) order by created_at,id),'[]') from public.studio_story_style_samples where workspace_id=p_workspace and ready);
end $$;
create function public.studio_story_style_media(p_workspace uuid,p_actor uuid,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.studio_story_style_samples;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict result from public.studio_story_style_samples where id=p_id and workspace_id=p_workspace and ready;
 return jsonb_build_object('path',result.path,'bytes',result.sample->'bytes','sha256',result.sample->'sha256');
end $$;

revoke all on function public.valid_story_presentation(jsonb),public.guard_story_style_history(),public.studio_story_save(uuid,uuid,uuid,jsonb),public.studio_story_presentation_save(uuid,uuid,uuid,int,uuid,jsonb,boolean),public.studio_story_next_presented(uuid,uuid,uuid,text),public.studio_story_next(uuid,uuid,uuid),public.studio_story_overview(uuid,uuid),public.register_story_style_sample(uuid,jsonb),public.ready_story_style_sample(uuid,uuid,text),public.studio_story_style_gallery(uuid,uuid),public.studio_story_style_media(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.valid_story_presentation(jsonb),public.studio_story_save(uuid,uuid,uuid,jsonb),public.studio_story_presentation_save(uuid,uuid,uuid,int,uuid,jsonb,boolean),public.studio_story_next_presented(uuid,uuid,uuid,text),public.studio_story_next(uuid,uuid,uuid),public.studio_story_overview(uuid,uuid),public.register_story_style_sample(uuid,jsonb),public.ready_story_style_sample(uuid,uuid,text),public.studio_story_style_gallery(uuid,uuid),public.studio_story_style_media(uuid,uuid,uuid) to service_role;
