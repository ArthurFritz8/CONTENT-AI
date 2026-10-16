-- Editable proposals and explicit continuity, without rewriting any produced snapshot.
alter table public.studio_series add column editorial_revision int not null default 0 check(editorial_revision between 0 and 1000);
alter table public.studio_series add column editorial_pins jsonb not null default '[]';
alter table public.studio_series add column editorial_memory jsonb not null default '{"relationships":"","secrets":"","characters":"","setting":"","open_threads":""}';
alter table public.studio_series add column editorial_guidance text not null default '';
alter table public.studio_story_chapters drop constraint studio_story_chapters_chapter_number_check;
alter table public.studio_story_chapters add check(chapter_number between 1 and 60);
alter table public.studio_story_presentations drop constraint studio_story_presentations_effective_from_check;
alter table public.studio_story_presentations add check(effective_from between 1 and 60);
create table public.studio_story_editorial_history(
 series_id uuid not null references public.studio_series(id),revision int not null,request_id uuid not null unique,
 actor uuid not null,input jsonb not null,created_at timestamptz not null default now(),primary key(series_id,revision)
);
create table public.studio_story_seasons(
 series_id uuid not null references public.studio_series(id),number int not null,title text not null,
 starts_at int not null,ends_at int not null,primary key(series_id,number),check(starts_at between 1 and 60 and ends_at between starts_at and 60)
);
create table public.studio_story_revisions(
 request_id uuid primary key,workspace_id uuid not null references public.studio_workspaces(id),series_id uuid not null references public.studio_series(id),
 actor uuid not null,input jsonb not null,result jsonb,created_at timestamptz not null default now()
);
alter table public.studio_story_editorial_history enable row level security;
alter table public.studio_story_seasons enable row level security;
alter table public.studio_story_revisions enable row level security;
revoke all on public.studio_story_editorial_history,public.studio_story_seasons,public.studio_story_revisions from public,anon,authenticated;
grant all on public.studio_story_editorial_history,public.studio_story_seasons,public.studio_story_revisions to service_role;
create trigger story_editorial_history_immutable before update or delete on public.studio_story_editorial_history for each row execute function public.guard_story_style_history();

create function public.studio_story_editorial_view(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;last_n int;result jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null;
 select coalesce(max(chapter_number),0) into last_n from public.studio_story_chapters where series_id=s.id;
 result:=jsonb_build_object('revision',s.editorial_revision,'bible',s.bible,'pins',s.editorial_pins,'memory',s.editorial_memory,'guidance',s.editorial_guidance,
 'planned_through',last_n,'cast_locked',last_n>0 or exists(select 1 from public.studio_production_media where series_id=s.id) or exists(select 1 from public.studio_series_production where series_id=s.id),
 'seasons',coalesce((select jsonb_agg(jsonb_build_object('number',number,'title',title,'starts_at',starts_at,'ends_at',ends_at) order by number) from public.studio_story_seasons where series_id=s.id),jsonb_build_array(jsonb_build_object('number',1,'title','Temporada 1','starts_at',1,'ends_at',jsonb_array_length(s.bible->'chapters')))),
 'history',coalesce((select jsonb_agg(jsonb_build_object('revision',revision,'created_at',created_at) order by revision desc) from (select revision,created_at from public.studio_story_editorial_history where series_id=s.id order by revision desc limit 20) h),'[]'),
 'storyboards',coalesce((select jsonb_agg(jsonb_build_object('chapter',c.chapter_number,'episode_id',e.id,'title',coalesce(n.draft->>'title',e.script_json#>>'{metadata,youtube,title}'),
 'summary',coalesce(n.draft->>'summary',e.script_json#>>'{fiction,summary}'),'scenes',coalesce(n.draft->'scenes',e.script_json->'scenes'),'approved',exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e))) order by c.chapter_number)
 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id join public.episodes e on e.id=i.episode_id left join public.studio_native_preparations n on n.episode_id=e.id where c.series_id=s.id),'[]'));
 return result;
end $$;

create function public.studio_story_editorial_save(p_workspace uuid,p_actor uuid,p_series uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;prior public.studio_story_editorial_history;b jsonb;last_n int;idx int;v jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_story_editorial_history where request_id=p_request;
 if found then
  if prior.series_id<>s.id or prior.actor<>p_actor or prior.input<>p_input then raise insufficient_privilege;end if;
  return jsonb_build_object('code','saved','revision',prior.revision);
 end if;
 if (p_input->>'revision')::int is distinct from s.editorial_revision then return '{"code":"revision_changed"}';end if;
 if s.editorial_revision>=999 then return '{"code":"version_limit"}';end if;
 b:=p_input->'bible';
 if octet_length(p_input::text)>150000 or jsonb_typeof(b) is distinct from 'object' or
  b->>'kind' is distinct from s.bible->>'kind' or b->>'genre' is distinct from s.bible->>'genre' or
  jsonb_array_length(b->'chapters') is distinct from jsonb_array_length(s.bible->'chapters') or
  jsonb_typeof(p_input->'pins') is distinct from 'array' or jsonb_array_length(p_input->'pins')>3 or
  exists(select 1 from jsonb_array_elements_text(p_input->'pins') x where x not in ('synopsis','cast','arcs')) or
  (select count(distinct x) from jsonb_array_elements_text(p_input->'pins') x)<>jsonb_array_length(p_input->'pins') or
  jsonb_typeof(p_input->'memory') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input->'memory'))<>5 or
  not ((p_input->'memory') ?& array['relationships','secrets','characters','setting','open_threads']) or
  jsonb_typeof(p_input->'guidance') is distinct from 'string' or char_length(p_input->>'guidance')>1000 then raise check_violation;end if;
 for v in select value from jsonb_each(p_input->'memory') loop
  if jsonb_typeof(v) is distinct from 'string' or char_length(v#>>'{}')>1500 then raise check_violation;end if;
 end loop;
 select coalesce(max(chapter_number),0) into last_n from public.studio_story_chapters where series_id=s.id;
 if last_n>0 then
  -- Future arcs and the ending can evolve; all identity/world fields and existing arcs remain exact.
  if b-array['chapters','ending'] is distinct from s.bible-array['chapters','ending'] then return '{"code":"story_locked"}';end if;
  for idx in 0..last_n-1 loop
   if b->'chapters'->idx is distinct from s.bible->'chapters'->idx then return '{"code":"chapter_locked"}';end if;
  end loop;
 end if;
 if (exists(select 1 from public.studio_production_media where series_id=s.id) or exists(select 1 from public.studio_series_production where series_id=s.id)) and
  (b->'cast' is distinct from s.bible->'cast' or b->'relationships' is distinct from s.bible->'relationships') then return '{"code":"cast_locked"}';end if;
 update public.studio_series set bible=b,editorial_revision=editorial_revision+1,editorial_pins=p_input->'pins',editorial_memory=p_input->'memory',editorial_guidance=p_input->>'guidance' where id=s.id;
 insert into public.studio_story_editorial_history values(s.id,s.editorial_revision+1,p_request,p_actor,p_input,now());
 return jsonb_build_object('code','saved','revision',s.editorial_revision+1);
end $$;

create function public.studio_story_revision_claim(p_workspace uuid,p_actor uuid,p_series uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;prior public.studio_story_revisions;section text;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_story_revisions where request_id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.series_id<>s.id or prior.input<>p_input then raise insufficient_privilege;end if;
  if prior.result is not null then return jsonb_build_object('code','preview','bible',prior.result);end if;
  return '{"code":"busy"}';
 end if;
 if (p_input->>'revision')::int is distinct from s.editorial_revision then return '{"code":"revision_changed"}';end if;
 section:=p_input->>'section';
 if section not in ('synopsis','cast','arcs','memory','season') or char_length(p_input->>'guidance')>1000 then raise check_violation;end if;
 if s.editorial_pins ? section then return '{"code":"section_pinned"}';end if;
 if (section in ('synopsis','cast','arcs') and exists(select 1 from public.studio_story_chapters where series_id=s.id)) or (section='cast' and (exists(select 1 from public.studio_production_media where series_id=s.id) or exists(select 1 from public.studio_series_production where series_id=s.id))) then return '{"code":"story_locked"}';end if;
 if (select count(*) from public.studio_story_revisions where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=6 then return '{"code":"daily_limit"}';end if;
 insert into public.studio_story_revisions(request_id,workspace_id,series_id,actor,input) values(p_request,p_workspace,s.id,p_actor,p_input);
 return jsonb_build_object('code','claimed','bible',s.bible,'memory',s.editorial_memory,'approved_summaries',coalesce((select jsonb_agg(e.script_json#>>'{fiction,summary}' order by c.chapter_number) from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id join public.episodes e on e.id=i.episode_id where c.series_id=s.id and exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e))),'[]'));
end $$;

create function public.studio_story_season_add(p_workspace uuid,p_actor uuid,p_series uuid,p_request uuid,p_revision int,p_season jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;last_n int;n int;count_new int;prior public.studio_story_editorial_history;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_story_editorial_history where request_id=p_request;
 if found then
  if prior.series_id<>s.id or prior.actor<>p_actor or prior.input<>jsonb_build_object('revision',p_revision,'season',p_season) then raise insufficient_privilege;end if;
  return '{"code":"saved"}';
 end if;
 if s.editorial_revision<>p_revision then return '{"code":"revision_changed"}';end if;
 if s.editorial_revision>=999 then return '{"code":"version_limit"}';end if;
 last_n:=jsonb_array_length(s.bible->'chapters');count_new:=jsonb_array_length(p_season->'chapters');
 if count_new is null or count_new not between 1 and 6 or last_n+count_new>60 or char_length(p_season->>'title') not between 5 and 100 or char_length(p_season->>'ending') not between 30 and 700 then raise check_violation;end if;
 if (select count(*) from public.studio_story_chapters where series_id=s.id)<>last_n or exists(
  select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id left join public.episodes e on e.id=i.episode_id
  where c.series_id=s.id and (e.id is null or not exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e)))) then return '{"code":"review_required"}';end if;
 insert into public.studio_story_seasons values(s.id,1,'Temporada 1',1,last_n) on conflict do nothing;
 select max(number)+1 into n from public.studio_story_seasons where series_id=s.id;
 insert into public.studio_story_seasons values(s.id,n,p_season->>'title',last_n+1,last_n+count_new);
 update public.studio_series set bible=jsonb_set(jsonb_set(bible,'{chapters}',(bible->'chapters')||(p_season->'chapters')),'{ending}',p_season->'ending'),editorial_revision=editorial_revision+1 where id=s.id;
 insert into public.studio_story_editorial_history values(s.id,s.editorial_revision+1,p_request,p_actor,jsonb_build_object('revision',p_revision,'season',p_season),now());
 return jsonb_build_object('code','saved','season',n,'revision',s.editorial_revision+1);
end $$;

revoke all on function public.studio_story_editorial_view(uuid,uuid,uuid),public.studio_story_editorial_save(uuid,uuid,uuid,uuid,jsonb),public.studio_story_revision_claim(uuid,uuid,uuid,uuid,jsonb),public.studio_story_season_add(uuid,uuid,uuid,uuid,int,jsonb) from public,anon,authenticated;
grant execute on function public.studio_story_editorial_view(uuid,uuid,uuid),public.studio_story_editorial_save(uuid,uuid,uuid,uuid,jsonb),public.studio_story_revision_claim(uuid,uuid,uuid,uuid,jsonb),public.studio_story_season_add(uuid,uuid,uuid,uuid,int,jsonb) to service_role;

-- Existing chapters keep their frozen bible; future arcs may evolve.
create or replace function public.studio_story_next_illustrated(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; ch public.studio_story_chapters; i public.idea_queue; ep public.episodes;
 summaries jsonb:='[]'; next_n int:=1; context jsonb; iid uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege; end if;
 for ch in select * from public.studio_story_chapters where series_id=s.id order by chapter_number loop
   select * into strict i from public.idea_queue where id=ch.idea_id and workspace_id=p_workspace;
   if i.status='pending' then return jsonb_build_object('code','queued','idea_id',i.id,'chapter_number',ch.chapter_number); end if;
   if i.status='rejected' then return '{"code":"chapter_cancelled"}'; end if;
   select * into ep from public.episodes where id=i.episode_id and workspace_id=p_workspace;
   if not found or not exists(select 1 from public.review_requests r where r.episode_id=ep.id
     and r.decision='approved' and r.fingerprint=public.review_fingerprint(ep)) then return '{"code":"review_required"}'; end if;
   if ep.script_json#>>'{fiction,context,series_id}' is distinct from s.id::text
     or ep.script_json#>>'{fiction,context,chapter_number}' is distinct from ch.chapter_number::text
     or (ep.script_json#>'{fiction,context,bible}')-array['chapters','ending'] is distinct from s.bible-array['chapters','ending']
     or ep.script_json#>array['fiction','context','bible','chapters',(ch.chapter_number-1)::text] is distinct from s.bible#>array['chapters',(ch.chapter_number-1)::text]
     or char_length(coalesce(ep.script_json#>>'{fiction,summary}','')) not between 30 and 1200 then raise check_violation; end if;
   summaries:=summaries||jsonb_build_array(ep.script_json#>>'{fiction,summary}');
   next_n:=ch.chapter_number+1;
 end loop;
 if next_n>jsonb_array_length(s.bible->'chapters') then return '{"code":"completed"}'; end if;
 if (select count(*) from public.idea_queue where workspace_id=p_workspace and status='pending')>=30 then return '{"code":"queue_full"}'; end if;
 if (select count(*) from public.idea_queue where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then return '{"code":"daily_limit"}'; end if;
 context:=jsonb_build_object('series_id',s.id,'bible',s.bible,'chapter_number',next_n,'previous_summaries',summaries);
 if s.editorial_revision>0 then
  context:=context||jsonb_build_object('editorial',jsonb_build_object('revision',s.editorial_revision,'memory',s.editorial_memory,'guidance',s.editorial_guidance));
 end if;
 insert into public.idea_queue(workspace_id,briefing,niche,priority,source,story_context)
 values(p_workspace,format('%s — capítulo %s: %s. Ficção original ilustrada, sem conteúdo comercial.',s.bible->>'title',next_n,s.bible#>>array['chapters',(next_n-1)::text,'title']),
  'Ficção original',500,'manual',context) returning id into iid;
 insert into public.studio_story_chapters(series_id,workspace_id,chapter_number,idea_id) values(s.id,p_workspace,next_n,iid);
 return jsonb_build_object('code','queued','idea_id',iid,'chapter_number',next_n);
end $$;
