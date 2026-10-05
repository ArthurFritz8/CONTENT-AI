-- ADR-045: optional, explicitly started fiction; no change to factual discovery.
alter table public.idea_queue add column story_context jsonb;
alter table public.idea_queue add constraint story_noncommercial check(story_context is null or
 (source='manual' and product_url is null and product_image_url is null and coalesce(affiliate_links,'{}')='{}'));
create table public.studio_series (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.studio_workspaces(id),
 bible jsonb not null check(jsonb_typeof(bible)='object'), created_at timestamptz not null default now(),
 archived_at timestamptz,
 unique(id,workspace_id)
);
create table public.studio_story_chapters (
 series_id uuid not null, workspace_id uuid not null, chapter_number int not null check(chapter_number between 1 and 6),
 idea_id uuid not null unique references public.idea_queue(id), created_at timestamptz not null default now(),
 primary key(series_id,chapter_number), foreign key(series_id,workspace_id) references public.studio_series(id,workspace_id)
);
create table public.studio_story_proposals (
 request_id uuid primary key, workspace_id uuid not null references public.studio_workspaces(id), actor uuid not null,
 input jsonb not null, series_id uuid references public.studio_series(id), lease_until timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.studio_series enable row level security;
alter table public.studio_story_chapters enable row level security;
alter table public.studio_story_proposals enable row level security;
grant all on public.studio_series,public.studio_story_chapters,public.studio_story_proposals to service_role;

-- A lease makes retries idempotent without duplicating model calls concurrently.
create function public.studio_story_claim(p_workspace uuid,p_actor uuid,p_request uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_story_proposals; n int;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('story-proposal-'||p_workspace));
 select * into prior from public.studio_story_proposals where request_id=p_request for update;
 if found then
   if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.input<>p_input then raise insufficient_privilege; end if;
   if prior.series_id is not null then return jsonb_build_object('code','saved','series_id',prior.series_id); end if;
   if prior.lease_until>now() then return '{"code":"busy"}'; end if;
 else
   select count(*) into n from public.studio_story_proposals where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
   if n>=3 then return '{"code":"daily_limit"}'; end if;
   if (select count(*) from public.studio_series where workspace_id=p_workspace and archived_at is null)>=30 then return '{"code":"series_limit"}'; end if;
   insert into public.studio_story_proposals(request_id,workspace_id,actor,input,lease_until)
     values(p_request,p_workspace,p_actor,p_input,now()+interval '3 minutes');
 end if;
 update public.studio_story_proposals set lease_until=now()+interval '3 minutes' where request_id=p_request;
 return '{"code":"claimed"}';
end $$;
create function public.studio_story_save(p_workspace uuid,p_actor uuid,p_request uuid,p_bible jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_story_proposals; sid uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict prior from public.studio_story_proposals where request_id=p_request for update;
 if prior.workspace_id<>p_workspace or prior.actor<>p_actor then raise insufficient_privilege; end if;
 if prior.series_id is not null then return prior.series_id; end if;
 if prior.lease_until<now() then raise check_violation using message='Proposal lease expired'; end if;
 if p_bible->>'kind' is distinct from prior.input->>'kind' or p_bible->>'genre' is distinct from prior.input->>'genre'
   or jsonb_array_length(p_bible->'chapters')<>(prior.input->>'chapters')::int then raise check_violation; end if;
 insert into public.studio_series(workspace_id,bible) values(p_workspace,p_bible) returning id into sid;
 update public.studio_story_proposals set series_id=sid where request_id=p_request;
 insert into public.job_events(workspace_id,event_type,metadata) values(p_workspace,'trend_discovered',jsonb_build_object('type','original_story_proposed','series_id',sid));
 return sid;
end $$;
create function public.studio_story_next(p_workspace uuid,p_actor uuid,p_series uuid) returns jsonb
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
     or ep.script_json#>'{fiction,context,bible}' is distinct from s.bible
     or char_length(coalesce(ep.script_json#>>'{fiction,summary}','')) not between 30 and 1200 then raise check_violation; end if;
   summaries:=summaries||jsonb_build_array(ep.script_json#>>'{fiction,summary}');
   next_n:=ch.chapter_number+1;
 end loop;
 if next_n>jsonb_array_length(s.bible->'chapters') then return '{"code":"completed"}'; end if;
 if (select count(*) from public.idea_queue where workspace_id=p_workspace and status='pending')>=30 then return '{"code":"queue_full"}'; end if;
 if (select count(*) from public.idea_queue where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then return '{"code":"daily_limit"}'; end if;
 context:=jsonb_build_object('series_id',s.id,'bible',s.bible,'chapter_number',next_n,'previous_summaries',summaries);
 insert into public.idea_queue(workspace_id,briefing,niche,priority,source,story_context)
 values(p_workspace,format('%s — capítulo %s: %s. Ficção original ilustrada, sem conteúdo comercial.',s.bible->>'title',next_n,s.bible#>>array['chapters',(next_n-1)::text,'title']),
  'Ficção original',500,'manual',context) returning id into iid;
 insert into public.studio_story_chapters(series_id,workspace_id,chapter_number,idea_id) values(s.id,p_workspace,next_n,iid);
 return jsonb_build_object('code','queued','idea_id',iid,'chapter_number',next_n);
end $$;

-- Preserve the old factual implementation; fiction only enters after explicit start.
alter function public.consume_idea_unchecked(uuid) rename to consume_idea_before_stories;
create function public.consume_idea_unchecked(p_idea_id uuid) returns table(episode_id uuid,idea_id uuid)
language plpgsql set search_path=public,pg_temp as $$
#variable_conflict use_column
declare i public.idea_queue; eid uuid; iid uuid;
begin
 select * into i from public.idea_queue where id=p_idea_id and status='pending' for update;
 if not found then return; end if;
 if i.story_context is not null and i.generation_requested_at is null then return; end if;
 select r.episode_id,r.idea_id into eid,iid from public.consume_idea_before_stories(p_idea_id) r;
 if eid is null then return; end if;
 if i.story_context is not null then
   update public.episodes set briefing=briefing||jsonb_build_object('story_context',i.story_context) where id=eid;
 end if;
 return query select eid,iid;
end $$;
create or replace function public.consume_next_idea_unchecked() returns table(episode_id uuid,idea_id uuid)
language plpgsql set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 select id into v_id from public.idea_queue where workspace_id='00000000-0000-4000-8000-000000000001'
 and status='pending' and (story_context is null or generation_requested_at is not null) and
 (source<>'trend_discovery' or (validated_at is not null and generation_requested_at is not null
 and selected_product is not null and selected_hook is not null and selected_evidence_url is not null))
 order by priority,created_at,id limit 1 for update skip locked;
 if v_id is not null then return query select * from public.consume_idea_unchecked(v_id); end if;
end $$;
alter function public.studio_command(uuid,uuid,uuid,text,jsonb) rename to studio_command_before_stories;
create function public.studio_command(p_workspace uuid,p_actor uuid,p_request uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if p_action in ('edit','choose_product') and exists(select 1 from public.idea_queue where id=(p_payload->>'id')::uuid and workspace_id=p_workspace and story_context is not null)
 then return '{"code":"story_locked"}'; end if;
 return public.studio_command_before_stories(p_workspace,p_actor,p_request,p_action,p_payload);
end $$;

create function public.reserve_story_provider_call() returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare cap int; n int; day_key text:=to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 select least(50,greatest(0,(value->>'openrouter_daily_cap')::int)) into cap from public.system_config where key='story_production';
 if coalesce(cap,0)=0 then return false; end if;
 insert into public.api_budget_usage(scope,period,used) values('story:openrouter',day_key,1)
 on conflict(scope,period) do update set used=api_budget_usage.used+1 where api_budget_usage.used<cap returning used into n;
 return n is not null;
end $$;
insert into public.system_config(key,value) values('story_production','{"openrouter_daily_cap":20,"openrouter_models":["nvidia/nemotron-3.5-lightning:free"]}') on conflict do nothing;
alter table public.job_events drop constraint job_events_event_type_check;
alter table public.job_events add constraint job_events_event_type_check check(event_type in (
 'script_generated','assets_generated','render_started','render_completed','render_checkpoint_saved','qa_passed','qa_failed','publish_started','publish_completed','analyze_completed','heartbeat_sent','budget_exceeded','failed','tts_fallback_triggered','state_transition','approval_received','approval_rejected','tts_engine_selected','tts_consistency_regeneration','research_completed','gemini_call','tavily_call','images_generated','tts_generated','subtitles_generated','trend_discovered','ai_provider_call'));
revoke all on function public.studio_story_claim(uuid,uuid,uuid,jsonb),public.studio_story_save(uuid,uuid,uuid,jsonb),public.studio_story_next(uuid,uuid,uuid),public.studio_command(uuid,uuid,uuid,text,jsonb),public.reserve_story_provider_call() from public,anon,authenticated;
grant execute on function public.studio_story_claim(uuid,uuid,uuid,jsonb),public.studio_story_save(uuid,uuid,uuid,jsonb),public.studio_story_next(uuid,uuid,uuid),public.studio_command(uuid,uuid,uuid,text,jsonb),public.reserve_story_provider_call() to service_role;
revoke all on function public.studio_command_before_stories(uuid,uuid,uuid,text,jsonb),public.consume_idea_unchecked(uuid) from public,anon,authenticated,service_role;

create function public.studio_story_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare settings jsonb; cap int; used int; proposals int; active int; series jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select w.settings into settings from public.studio_workspaces w where w.id=p_workspace;
 if p_workspace='00000000-0000-4000-8000-000000000001' then select jsonb_build_object('pipeline',value) into settings from public.system_config where key='pipeline'; end if;
 cap:=least(3,greatest(1,coalesce((settings#>>'{pipeline,max_episodes_per_day}')::int,1)));
 select count(*) into used from public.episodes where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select count(*) into proposals from public.studio_story_proposals where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select count(*) into active from public.episodes where workspace_id=p_workspace and status in ('idea','research','script','assets','rendered');
 select coalesce(jsonb_agg(item order by created_at desc),'[]') into series from (
   select s.created_at,jsonb_build_object('id',s.id,'bible',s.bible,'created_at',s.created_at,'chapters',
     coalesce((select jsonb_agg(jsonb_build_object('number',c.chapter_number,'idea_id',i.id,'idea_status',i.status,'revision',i.revision,
       'episode_id',ep.id,'status',ep.status,'approved',exists(select 1 from public.review_requests r where r.episode_id=ep.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(ep))) order by c.chapter_number)
       from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id left join public.episodes ep on ep.id=i.episode_id where c.series_id=s.id),'[]')) item
   from public.studio_series s where s.workspace_id=p_workspace and s.archived_at is null) q;
 return jsonb_build_object('series',series,'daily_cap',cap,'generated_today',used,'daily_remaining',greatest(0,cap-used),'active',active,'proposals_remaining',greatest(0,3-proposals));
end $$;
revoke all on function public.studio_story_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_overview(uuid,uuid) to service_role;

create function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series; ch public.studio_story_chapters; i public.idea_queue; ep public.episodes; iid uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 if not found then raise insufficient_privilege; end if;
 select * into ch from public.studio_story_chapters where series_id=s.id order by chapter_number desc limit 1;
 if found then
  select * into strict i from public.idea_queue where id=ch.idea_id and workspace_id=p_workspace;
  select * into ep from public.episodes where id=i.episode_id and workspace_id=p_workspace;
 end if;
 if p_action='archive' then
  if i.status='pending' or ep.status in ('idea','research','script','assets','rendered') then return '{"code":"chapter_active"}'; end if;
  update public.studio_series set archived_at=now() where id=s.id;
  return '{"code":"archived"}';
 elsif p_action='retry' then
  if i.status='pending' then return jsonb_build_object('code','queued','idea_id',i.id,'chapter_number',ch.chapter_number); end if;
  if ep.status is distinct from 'failed' then return '{"code":"retry_unavailable"}'; end if;
  if (select count(*) from public.idea_queue where workspace_id=p_workspace and status='pending')>=30 then return '{"code":"queue_full"}'; end if;
  if (select count(*) from public.idea_queue where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then return '{"code":"daily_limit"}'; end if;
  insert into public.idea_queue(workspace_id,briefing,niche,priority,source,story_context)
    values(p_workspace,i.briefing,i.niche,i.priority,'manual',i.story_context) returning id into iid;
  update public.studio_story_chapters set idea_id=iid where series_id=s.id and chapter_number=ch.chapter_number;
  return jsonb_build_object('code','queued','idea_id',iid,'chapter_number',ch.chapter_number);
 else raise check_violation; end if;
end $$;
revoke all on function public.studio_story_manage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_manage(uuid,uuid,uuid,text) to service_role;

-- Only fiction gains a briefing snapshot; existing factual approvals stay unchanged.
create or replace function public.review_snapshot(ep public.episodes) returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('episode',jsonb_build_object('id',ep.id,'script_hash',ep.script_hash,'script_json',ep.script_json,'render_url',ep.render_url,'research_data',ep.research_data,'research_evidence',ep.research_evidence,'product_compliance',ep.product_compliance,'metadata',jsonb_build_object('render_outputs',ep.metadata->'render_outputs','render_generation',ep.metadata->'render_generation'))
   ||case when ep.briefing->'story_context' is not null then jsonb_build_object('briefing',jsonb_build_object('story_context',ep.briefing->'story_context')) else '{}'::jsonb end,
 'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_at'-'workspace_id' order by a.id) from public.assets a where a.episode_id=ep.id),'[]'::jsonb),
 'fact_check',(select value from public.system_config where key='fact_check'));
$$;
