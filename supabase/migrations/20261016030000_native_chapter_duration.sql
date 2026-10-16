-- Longer chapters are more original five-second takes, never stretched or interpolated.
-- Old contexts omit native_format and retain their original hashes and job identities.
alter table public.studio_series add column native_shots int not null default 3 check(native_shots in (3,6,9));
alter table public.studio_series add column native_format_revision int not null default 0 check(native_format_revision between 0 and 999);
create table public.studio_story_format_history(
 request_id uuid primary key,series_id uuid not null references public.studio_series(id),actor uuid not null,
 revision int not null,shots int not null check(shots in (3,6,9)),created_at timestamptz not null default now(),unique(series_id,revision)
);
alter table public.studio_story_format_history enable row level security;
revoke all on public.studio_story_format_history from public,anon,authenticated;
grant all on public.studio_story_format_history to service_role;
create trigger story_format_history_immutable before update or delete on public.studio_story_format_history for each row execute function public.guard_story_style_history();
create function public.native_chapter_shots(p_context jsonb) returns int language plpgsql immutable set search_path=public,pg_temp as $$
declare n int:=coalesce((p_context#>>'{native_format,shots}')::int,3);
begin
 if n not in (3,6,9) or (p_context ? 'native_format' and p_context->'native_format' is distinct from jsonb_build_object('shots',n)) then raise check_violation;end if;
 return n;
end $$;
revoke all on function public.native_chapter_shots(jsonb) from public,anon,authenticated;
grant execute on function public.native_chapter_shots(jsonb) to service_role;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.studio_native_runs'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%reserved_credits%' or pg_get_constraintdef(oid) like '%jsonb_array_length%') loop
 execute format('alter table public.studio_native_runs drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.studio_native_runs add check(state->>'reserved_credits' in ('5','15','30','45'));
alter table public.studio_native_runs add check(jsonb_typeof(state->'tasks')='array' and jsonb_array_length(state->'tasks')=public.native_chapter_shots(state->'context') and jsonb_array_length(state#>'{draft,scenes}')=jsonb_array_length(state->'tasks'));
alter table public.studio_native_repairs drop constraint studio_native_repairs_shot_index_check;
alter table public.studio_native_repairs add check(shot_index between 0 and 8);
create function public.studio_story_duration_save(p_workspace uuid,p_actor uuid,p_series uuid,p_request uuid,p_revision int,p_shots int) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;prior public.studio_story_format_history;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into prior from public.studio_story_format_history where request_id=p_request;
 if found then
  if prior.series_id<>s.id or prior.actor<>p_actor or prior.shots is distinct from p_shots or prior.revision is distinct from p_revision+1 then raise insufficient_privilege;end if;
  return jsonb_build_object('code','saved','revision',prior.revision,'shots',prior.shots);
 end if;
 if p_shots is null or p_shots not in (3,6,9) or p_revision is null or p_revision not between 0 and 998 then raise check_violation;end if;
 if s.native_format_revision<>p_revision then return '{"code":"revision_changed"}';end if;
 update public.studio_series set native_shots=p_shots,native_format_revision=native_format_revision+1 where id=s.id;
 insert into public.studio_story_format_history(request_id,series_id,actor,revision,shots) values(p_request,s.id,p_actor,p_revision+1,p_shots);
 return jsonb_build_object('code','saved','revision',p_revision+1,'shots',p_shots);
end $$;
revoke all on function public.studio_story_duration_save(uuid,uuid,uuid,uuid,int,int) from public,anon,authenticated;
grant execute on function public.studio_story_duration_save(uuid,uuid,uuid,uuid,int,int) to service_role;


create or replace function public.studio_story_save(p_workspace uuid,p_actor uuid,p_request uuid,p_bible jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; pref jsonb;initial boolean;shots int;
begin
 select series_id is null,coalesce((input->>'native_shots')::int,3) into strict initial,shots from public.studio_story_proposals where request_id=p_request for update;
 if shots not in (3,6,9) then raise check_violation;end if;
 sid:=public.studio_story_save_before_presentation(p_workspace,p_actor,p_request,p_bible);
 select input->'presentation' into pref from public.studio_story_proposals where request_id=p_request;
 if pref is not null then
  if not public.valid_story_presentation(pref) then raise check_violation; end if;
  insert into public.studio_story_presentations(series_id,workspace_id,revision,effective_from,preferences,request_id,created_by)
   values(sid,p_workspace,1,1,pref,p_request,p_actor) on conflict(request_id) do nothing;
  if not exists(select 1 from public.studio_story_presentations where series_id=sid and request_id=p_request and preferences=pref and created_by=p_actor) then raise insufficient_privilege; end if;
 end if;
 if initial then update public.studio_series set native_shots=shots where id=sid;end if;
 return sid;
end $$;

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
 if s.native_shots<>3 then context:=context||jsonb_build_object('native_format',jsonb_build_object('shots',s.native_shots));end if;
 if s.editorial_revision>0 then
  context:=context||jsonb_build_object('editorial',jsonb_build_object('revision',s.editorial_revision,'memory',s.editorial_memory,'guidance',s.editorial_guidance));
 end if;
 insert into public.idea_queue(workspace_id,briefing,niche,priority,source,story_context)
 values(p_workspace,format('%s — capítulo %s: %s. Ficção original ilustrada, sem conteúdo comercial.',s.bible->>'title',next_n,s.bible#>>array['chapters',(next_n-1)::text,'title']),
  'Ficção original',500,'manual',context) returning id into iid;
 insert into public.studio_story_chapters(series_id,workspace_id,chapter_number,idea_id) values(s.id,p_workspace,next_n,iid);
 return jsonb_build_object('code','queued','idea_id',iid,'chapter_number',next_n);
end $$;

create or replace function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;wallets jsonb;progress jsonb;enabled boolean;
begin
 result:=public.studio_video_overview_before_native_panel(p_workspace,p_actor);
 enabled:=coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false);
 select coalesce(jsonb_agg(v||case when v->>'provider'='auray' then jsonb_build_object('native_enabled',enabled,
   'native_chapter_credits',15,'native_chapter_seconds',15,
   'native_budget_chapters',case when v->>'budget_only_shots' is not null then (v->>'budget_only_shots')::int/3 end,
   'source_blockers',coalesce(v->'source_blockers','[]')-'production_adapter_pending'-(case when enabled then 'source_disabled' else '__none__' end)) else '{}'::jsonb end order by v->>'label'),'[]') into wallets from jsonb_array_elements(result->'wallets') v;
 select coalesce(jsonb_agg(jsonb_build_object('episode_id',p.episode_id,'completed_shots',(select count(*) from jsonb_array_elements(coalesce(r.state->'tasks','[]')) x where x->>'phase'='ready'),
  'total_shots',public.native_chapter_shots(e.briefing->'story_context'),'planned_seconds',public.native_chapter_shots(e.briefing->'story_context')*5,'output_fps',24,'stage',case when r.closed_at is not null or p.cancel_requested and e.status='failed' then 'cancelled' when p.cancel_requested then 'cancellation_pending'
   when e.status in ('rendered','review','published','analyze') then e.status when r.state->'output' is distinct from 'null'::jsonb and r.state->'output' is not null then 'ready_for_assembly'
   when exists(select 1 from jsonb_array_elements(coalesce(r.state->'tasks','[]')) x where x->>'phase' in ('failed','rejected','submission_unknown')) then 'reconciliation_required'
   when r.episode_id is null then 'awaiting_capacity' else 'generating_clips' end,'last_code',p.last_code,'cancel_requested',p.cancel_requested,'closed',r.closed_at is not null or p.cancel_requested and e.status='failed')
  order by p.created_at),'[]') into progress from public.studio_native_preparations p join public.episodes e on e.id=p.episode_id left join public.studio_native_runs r on r.episode_id=p.episode_id where p.workspace_id=p_workspace;
 return jsonb_set(result,'{wallets}',wallets)||jsonb_build_object('native_enabled',enabled,'native_chapters',progress);
end $$;

alter function public.studio_story_overview(uuid,uuid) rename to studio_story_overview_before_duration;
revoke all on function public.studio_story_overview_before_duration(uuid,uuid) from service_role;
create function public.studio_story_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;series jsonb;
begin
 result:=public.studio_story_overview_before_duration(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||jsonb_build_object('native_shots',s.native_shots,'native_format_revision',s.native_format_revision,
  'chapters',coalesce((select jsonb_agg(ch||jsonb_build_object('native_shots',public.native_chapter_shots(i.story_context)) order by (ch->>'number')::int)
    from jsonb_array_elements(v->'chapters') ch join public.studio_story_chapters c on c.series_id=s.id and c.chapter_number=(ch->>'number')::int join public.idea_queue i on i.id=c.idea_id),'[]')) order by s.created_at desc),'[]') into series
 from jsonb_array_elements(result->'series') v join public.studio_series s on s.id=(v->>'id')::uuid and s.workspace_id=p_workspace;
 return jsonb_set(result,'{series}',series);
end $$;
revoke all on function public.studio_story_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_story_overview(uuid,uuid) to service_role;

create or replace function public.save_native_draft(p_episode uuid,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;prior public.studio_native_preparations;
begin
 select * into strict e from public.episodes where id=p_episode for update;
 if public.story_episode_profile_hash(e.id) is distinct from p_profile or (public.studio_story_episode_profile(e.id)#>>'{profile,version}') is distinct from 'auray-native-1.0.0' then raise check_violation;end if;
 select * into prior from public.studio_native_preparations where episode_id=e.id;
 if found then
  if prior.profile_sha256<>p_profile or prior.fingerprint<>p_fingerprint or prior.draft<>p_draft then raise check_violation;end if;
  return '{"code":"prepared"}';
 end if;
 if e.status<>'research' or coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' or octet_length(p_draft::text)>32768 or jsonb_array_length(p_draft->'scenes') is distinct from public.native_chapter_shots(e.briefing->'story_context') or
  not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) then raise check_violation;end if;
 insert into public.studio_native_preparations(episode_id,workspace_id,profile_sha256,fingerprint,draft) values(e.id,e.workspace_id,p_profile,p_fingerprint,p_draft);
 update public.episodes set metadata=coalesce(metadata,'{}')||'{"native_chapter":true}' where id=e.id;
 return '{"code":"prepared"}';
end $$;

create or replace function public.studio_native_repair_prepare(p_workspace uuid,p_actor uuid,p_episode uuid,p_request uuid,p_edit jsonb,p_draft jsonb,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;r public.studio_native_runs;ch public.studio_story_chapters;i public.idea_queue;new_idea uuid;new_episode uuid;
 prior public.studio_native_repairs;idx int;new_shot int;reply jsonb;before jsonb;after jsonb;n int;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into prior from public.studio_native_repairs where request_id=p_request;
 if found then
  if prior.workspace_id<>p_workspace or prior.actor<>p_actor or prior.source_episode<>p_episode or prior.input<>p_edit then raise insufficient_privilege;end if;
  return jsonb_build_object('code','started','episode_id',prior.episode_id);
 end if;
 select * into strict e from public.episodes where id=p_episode and workspace_id=p_workspace for update;
 select * into strict r from public.studio_native_runs where episode_id=e.id for update;
 select c.* into ch from public.studio_story_chapters c join public.idea_queue q on q.id=c.idea_id where q.episode_id=e.id for update of c;
 if ch.series_id is null or e.status<>'review' or r.held or r.state->'output' is not distinct from 'null'::jsonb or
  exists(select 1 from public.studio_story_chapters where series_id=ch.series_id and chapter_number>ch.chapter_number) then return '{"code":"repair_locked"}';end if;
 n:=public.native_chapter_shots(r.state->'context');
 if coalesce((p_edit->>'index')::int,-1) not between 0 and n-1 or coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' or octet_length(p_draft::text)>32768 or
  p_draft-array['scenes','summary'] is distinct from (r.state->'draft')-array['scenes','summary'] or jsonb_array_length(p_draft->'scenes') is distinct from n or
  p_draft->>'summary' is distinct from p_edit->>'summary' then raise check_violation;end if;
 new_shot:=(p_edit->>'index')::int;
 for idx in 0..n-1 loop
  before:=r.state->'draft'->'scenes'->idx;after:=p_draft->'scenes'->idx;
  if idx<>new_shot then
   if after is distinct from before then raise check_violation;end if;
  elsif after-array['narration_text','prompt','seed'] is distinct from before-array['narration_text','prompt','seed'] or
   after->>'narration_text' is distinct from p_edit->>'dialogue' or after->>'prompt' is distinct from p_edit->>'prompt' or
   (after->>'seed')::bigint is distinct from (((before->>'seed')::bigint+1)%2147483648) then raise check_violation;end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(public.studio_video_overview(p_workspace,p_actor)->'wallets') v join public.studio_auray_config a on a.wallet_id=(v->>'id')::uuid where v->>'id'=r.wallet_id::text and v->>'native_enabled'='true' and v->>'balance_fresh'='true' and (v->>'budget_only_shots')::int>=1 and a.observation->'blockers'='[]'::jsonb and not a.sync_error) then return '{"code":"repair_budget_required"}';end if;
 select * into strict i from public.idea_queue where id=ch.idea_id;
 insert into public.idea_queue(workspace_id,briefing,niche,priority,source,story_context) values(p_workspace,i.briefing,i.niche,i.priority,'manual',r.state->'context') returning id into new_idea;
 update public.studio_story_chapters set idea_id=new_idea where series_id=ch.series_id and chapter_number=ch.chapter_number;
 reply:=public.studio_command(p_workspace,p_actor,p_request,'generate_video',jsonb_build_object('id',new_idea,'revision',(select revision from public.idea_queue where id=new_idea)));
 if reply->>'code'<>'started' then raise check_violation using message='O limite diário ou outra geração impede a correção agora.';end if;
 new_episode:=(reply->>'episode_id')::uuid;
 insert into public.studio_native_preparations(episode_id,workspace_id,profile_sha256,fingerprint,draft) values(new_episode,p_workspace,public.story_episode_profile_hash(new_episode),p_fingerprint,p_draft);
 insert into public.studio_native_repairs values(p_request,p_workspace,p_actor,p_episode,new_episode,new_shot,p_edit,null,now());
 update public.episodes set metadata=coalesce(metadata,'{}')||jsonb_build_object('native_chapter',true,'native_repair_of',p_episode,'native_repair_shot',new_shot) where id=new_episode;
 return jsonb_build_object('code','started','episode_id',new_episode,'reserved_credits',5);
end $$;

create or replace function public.native_worker_input(p_episode uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;r public.studio_native_repairs;s public.studio_native_runs;reuse jsonb;
begin
 result:=public.native_worker_input_before_repair(p_episode);
 if result->>'code'<>'prepare' then return result;end if;
 select * into r from public.studio_native_repairs where episode_id=p_episode and restored_at is null;
 if not found then return result;end if;
 select * into strict s from public.studio_native_runs where episode_id=r.source_episode and not held and workspace_id=r.workspace_id;
 if exists(select 1 from public.studio_native_runs where wallet_id=s.wallet_id and held) then return '{"code":"wallet_reserved"}';end if;
 if s.state->'profile' is distinct from result->'profile' or s.state->'context' is distinct from result->'context' then raise check_violation;end if;
 select jsonb_agg(jsonb_build_object('index',idx,'episode_id',s.episode_id,'clip',s.state->'tasks'->idx->'clip') order by idx) into reuse from generate_series(0,public.native_chapter_shots(s.state->'context')-1) idx where idx<>r.shot_index;
 return result||jsonb_build_object('reuse',reuse,'wallet_id',s.wallet_id);
end $$;

create or replace function public.reserve_native_chapter(p_episode uuid,p_wallet uuid,p_run jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes; c public.studio_auray_config; profile jsonb; pref jsonb; prior public.studio_native_runs; task jsonb; stamp timestamptz; repair public.studio_native_repairs; origin public.studio_native_runs; needed int;n int; idx int:=0; reused jsonb;
begin
 select * into strict e from public.episodes where id=p_episode for update;
 select * into strict c from public.studio_auray_config where wallet_id=p_wallet for update;
 select * into prior from public.studio_native_runs where episode_id=p_episode;
 if found then
  if prior.wallet_id<>p_wallet or prior.state->>'fingerprint' is distinct from p_run->>'fingerprint' then raise check_violation;end if;
  return jsonb_build_object('code','existing');
 end if;
 if not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
 if e.status<>'research' or e.workspace_id is null or not exists(select 1 from public.studio_video_wallet_access where wallet_id=p_wallet and workspace_id=e.workspace_id) then raise insufficient_privilege;end if;
 if exists(select 1 from public.studio_native_runs where wallet_id=p_wallet and held) then return '{"code":"wallet_reserved"}';end if;
 if exists(select 1 from public.studio_video_jobs where episode_id=p_episode) or exists(select 1 from public.studio_animation_preparations where episode_id=p_episode) then raise check_violation;end if;
 profile:=public.studio_story_episode_profile(p_episode)->'profile';
 select p.preferences into strict pref from public.studio_story_chapters ch join public.idea_queue i on i.id=ch.idea_id
  join public.studio_chapter_presentations b using(series_id,chapter_number)
  join public.studio_story_presentations p on p.series_id=b.series_id and p.revision=b.revision where i.episode_id=e.id;
 if pref->>'source' is distinct from 'auray' or pref->>'voice_policy' is distinct from 'approved_variants' or
  profile->>'version' is distinct from 'auray-native-1.0.0' or profile->>'native_voice_acknowledged' is distinct from 'true' or
  profile->>'voice_policy' is distinct from 'provider_generated_review' or profile->>'model' is distinct from 'auray-ai/minimax-h3/text-to-video' or
  profile->>'contract_sha256' is distinct from p_run->>'contract_sha256' or profile is distinct from p_run->'profile' or
  e.briefing->'story_context' is distinct from p_run->'context' then raise check_violation;end if;
 if not exists(select 1 from public.studio_story_style_samples s join public.studio_chapter_presentations b on b.series_id=(e.briefing#>>'{story_context,series_id}')::uuid and b.chapter_number=(e.briefing#>>'{story_context,chapter_number}')::int
   where s.id=(profile#>>'{example,id}')::uuid and s.workspace_id=e.workspace_id and s.ready and s.sample->>'sha256'=profile#>>'{example,sha256}' and
    s.sample->>'source'='auray' and s.sample->>'style_id'=b.style_id and s.sample->>'review_scope'='reviewed_sample') then raise check_violation;end if;
 n:=public.native_chapter_shots(p_run->'context');needed:=n*5;
 if jsonb_array_length(p_run#>'{draft,scenes}') is distinct from n then raise check_violation;end if;
 select * into repair from public.studio_native_repairs where episode_id=p_episode and restored_at is null;
 if found then
  needed:=5;select * into strict origin from public.studio_native_runs where episode_id=repair.source_episode and workspace_id=e.workspace_id and not held;
  if origin.wallet_id<>p_wallet or origin.state->'profile' is distinct from p_run->'profile' or origin.state->'context' is distinct from p_run->'context' or
   not exists(select 1 from public.studio_native_preparations where episode_id=p_episode and draft=p_run->'draft' and fingerprint=p_run->>'fingerprint') then raise check_violation;end if;
 end if;
 stamp:=(p_run->>'reserved_at')::timestamptz;
 if stamp is null or stamp not between now()-interval '2 minutes' and now()+interval '5 seconds' or
  p_run->>'period' is distinct from to_char(now() at time zone 'UTC','YYYY-MM') or
  p_run->>'episode_id' is distinct from p_episode::text or p_run->>'version' is distinct from '1' or
  p_run->>'reserved_credits' is distinct from needed::text or p_run->>'revision' is distinct from '0' or p_run->'output' is distinct from 'null'::jsonb or
  p_run->>'budget_reconciled' is distinct from 'false' or coalesce((p_run->>'initial_plan_remaining')::int,0)<needed or
  coalesce((p_run->>'initial_key_remaining')::int,0)<needed or coalesce(p_run->>'fingerprint','')!~'^[a-f0-9]{64}$' or
  c.account_sha256 is distinct from encode(sha256(convert_to('{"account":'||to_jsonb(p_run->>'account_id')::text||',"provider":"auray"}','UTF8')),'hex') or
  jsonb_typeof(p_run->'tasks') is distinct from 'array' or jsonb_array_length(p_run->'tasks')<>n then raise check_violation;end if;
 for task in select value from jsonb_array_elements(p_run->'tasks') loop
  if coalesce(task->>'request_key','')!~'^[a-f0-9]{64}$' or task->>'job_id' is distinct from 'video_'||(task->>'request_key') then raise check_violation;end if;
  if repair.episode_id is not null and idx<>repair.shot_index then
   reused:=jsonb_build_object('index',idx,'episode_id',origin.episode_id,'clip',origin.state->'tasks'->idx->'clip');
   if task->'reused' is distinct from reused or task->>'phase' is distinct from 'ready' or task->>'settled' is distinct from 'true' or task->>'charged_credits' is distinct from '0' or
    task->'clip' is distinct from ((origin.state->'tasks'->idx->'clip')||jsonb_build_object('request_key',task->>'request_key','path','episodes/'||p_episode||'/native/'||(reused#>>'{clip,sha256}')||'.mp4')) then raise check_violation;end if;
  elsif task ? 'reused' or task->>'phase' is distinct from 'planned' or task->>'charged_credits' is distinct from '0' or task->>'settled' is distinct from 'false' or task->'clip' is distinct from 'null'::jsonb then raise check_violation;end if;
  idx:=idx+1;
 end loop;
 if (select count(distinct value->>'request_key') from jsonb_array_elements(p_run->'tasks'))<>n then raise check_violation;end if;
 insert into public.studio_native_runs(episode_id,workspace_id,wallet_id,state) values(p_episode,e.workspace_id,p_wallet,p_run);
 return '{"code":"reserved"}';
end $$;

create or replace function public.save_native_chapter(p_episode uuid,p_token uuid,p_state jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_native_runs; a jsonb; b jsonb; i int; base text;
begin
 perform public.guard_native_chapter(p_episode,p_token);
 select * into strict prior from public.studio_native_runs where episode_id=p_episode for update;
 -- Idempotent acknowledgement when the previous database response was lost.
 if prior.state=p_state then return;end if;
 if (p_state->>'revision')::int is distinct from (prior.state->>'revision')::int+1 or
  (p_state-array['revision','tasks','output','budget_reconciled','not_before']) is distinct from (prior.state-array['revision','tasks','output','budget_reconciled','not_before']) or
  jsonb_typeof(p_state->'tasks') is distinct from 'array' or jsonb_array_length(p_state->'tasks') is distinct from public.native_chapter_shots(prior.state->'context') then raise check_violation;end if;
 for i in 0..jsonb_array_length(prior.state->'tasks')-1 loop
  a:=prior.state->'tasks'->i;b:=p_state->'tasks'->i;
  if b->>'request_key' is distinct from a->>'request_key' or b->>'job_id' is distinct from a->>'job_id' or
   coalesce((b->>'charged_credits')::int,-1) not between (a->>'charged_credits')::int and 5 or
   b->>'settled' is null or (a->>'settled'='true' and b->>'settled'<>'true') or b->>'phase' is null or
   b->>'phase' not in ('planned','submission_started','submitted','submission_unknown','rejected','waiting','failed','ready') or
   (a->>'phase'='ready' and a<>b) or (a->>'phase'<>'planned' and b->>'phase'='planned') or
   (a->>'phase'<>'planned' and b->>'phase'='submission_started') or
   (a->>'phase'='planned' and b->>'phase' not in ('planned','submission_started')) or
   (a->>'phase'='failed' and a<>b) then raise check_violation;end if;
  if b->>'phase'='planned' and ((b->>'charged_credits')::int<>0 or b->>'settled'<>'false' or b->'clip' is distinct from 'null'::jsonb) then raise check_violation;end if;
  if b->>'phase'='ready' then
   if b->>'settled'<>'true' or b#>>'{clip,request_key}' is distinct from b->>'request_key' or coalesce(b#>>'{clip,sha256}','')!~'^[a-f0-9]{64}$' or
    coalesce((b#>>'{clip,frames}')::int,0) not between 116 and 124 or b#>>'{clip,path}' is distinct from 'episodes/'||p_episode||'/native/'||(b#>>'{clip,sha256}')||'.mp4' then raise check_violation;end if;
  elsif b->'clip' is distinct from 'null'::jsonb then raise check_violation;end if;
  if i>0 and (p_state->'tasks'->(i-1)->>'phase')<>'ready' and b->>'phase'<>'planned' and not(b ? 'reused') then raise check_violation;end if;
 end loop;
 if (prior.state->'output' is distinct from 'null'::jsonb and prior.state->'output' is distinct from p_state->'output') or
  (prior.state->>'budget_reconciled'='true' and p_state->>'budget_reconciled' is distinct from 'true') or p_state->>'budget_reconciled' is null then raise check_violation;end if;
 if p_state->'output' is distinct from 'null'::jsonb or p_state->>'budget_reconciled'='true' then
  if exists(select 1 from jsonb_array_elements(p_state->'tasks') x where x->>'phase'<>'ready') or p_state->'output' is not distinct from 'null'::jsonb then raise check_violation;end if;
  base:='episodes/'||p_episode||'/native/';a:=p_state->'output';
  if coalesce(a->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(a->>'script_sha256','')!~'^[a-f0-9]{64}$' or coalesce(a->>'qa_sha256','')!~'^[a-f0-9]{64}$' or
   a->>'path' is distinct from base||(a->>'sha256')||'.mp4' or a->>'script_path' is distinct from base||(a->>'script_sha256')||'.json' or
   a->>'qa_path' is distinct from base||(a->>'qa_sha256')||'.json' or coalesce((a->>'bytes')::int,0) not between 1 and 52428800 then raise check_violation;end if;
 end if;
 update public.studio_native_runs set state=p_state,held=p_state->>'budget_reconciled'<>'true',updated_at=now() where episode_id=p_episode;
 -- Keep the previous amount as history; a potentially charged request makes it
 -- unsuitable for a fresh capacity estimate until the next provider inspection.
 if prior.state->'tasks' is distinct from p_state->'tasks' then
  update public.studio_video_wallets set valid_until=null where id=prior.wallet_id;
 end if;
end $$;

create or replace function public.complete_native_chapter_before_policy(p_episode uuid,p_token uuid,p_origin text,p_script_text text,p_qa_text text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs;e public.episodes;s jsonb;q jsonb;t jsonb;scene jsonb;cut jsonb;ref jsonb;i int;frames int:=0;url text;
begin
 perform public.guard_native_chapter(p_episode,p_token);
 select * into strict r from public.studio_native_runs where episode_id=p_episode for update;
 select * into strict e from public.episodes where id=p_episode for update;
 if r.state->'output' is not distinct from 'null'::jsonb or exists(select 1 from jsonb_array_elements(r.state->'tasks') x where x->>'phase'<>'ready') then raise check_violation;end if;
 if p_origin is null or p_origin!~'^https://[a-z0-9-]+\.supabase\.co$' or p_script_text is null or p_qa_text is null or
  octet_length(p_script_text)>1048576 or octet_length(p_qa_text)>1048576 or
  encode(sha256(convert_to(p_script_text,'UTF8')),'hex') is distinct from r.state#>>'{output,script_sha256}' or
  encode(sha256(convert_to(p_qa_text,'UTF8')),'hex') is distinct from r.state#>>'{output,qa_sha256}' then raise check_violation;end if;
 s:=p_script_text::jsonb;q:=p_qa_text::jsonb;
 if s->>'episode_id' is distinct from e.id::text or s#>'{fiction,context}' is distinct from e.briefing->'story_context' or
  s#>'{fiction,context}' is distinct from r.state->'context' or s#>'{fiction,summary}' is distinct from r.state#>'{draft,summary}' or
  s#>>'{fiction,native_animation,profile_sha256}' is distinct from public.story_episode_profile_hash(e.id) or
  s#>'{fiction,native_animation}' is distinct from jsonb_build_object('version','1.0.0','provider','auray','profile_sha256',public.story_episode_profile_hash(e.id),
    'width',768,'height',1344,'output_fps',24,'voice_identity_preserved',false,'speech_transcription_verified',false,'human_review_required',true) or
  s#>'{fiction,animation}' is not null or s->>'gap_seconds' is distinct from '0' or s->'music' is distinct from 'null'::jsonb or s?'platform_ctas' or
  s#>>'{disclosures,contains_synthetic_media}' is distinct from 'true' or s#>>'{disclosures,commercial_content}' is distinct from 'false' or
  s->'sources' is distinct from '[]'::jsonb or jsonb_array_length(s->'scenes') is distinct from jsonb_array_length(r.state->'tasks') or jsonb_array_length(q->'cuts') is distinct from jsonb_array_length(r.state->'tasks') or
  q->>'episode_id' is distinct from e.id::text or q->>'fingerprint' is distinct from r.state->>'fingerprint' or q->>'sha256' is distinct from r.state#>>'{output,sha256}' or
  q->>'width' is distinct from '768' or q->>'height' is distinct from '1344' or q->>'encoded_fps' is distinct from '24' or
  q->>'all_decoded_frames_pixel_identical' is distinct from 'true' or q->>'video_reencoded' is distinct from 'false' or
  q->>'audio_encoded_once_from_native_pcm' is distinct from 'true' or q->>'decode_verified' is distinct from 'true' or
  q->>'human_review_required' is distinct from 'true' or q->>'voice_continuity_approved' is distinct from 'false' or q->>'production_ready' is distinct from 'false' or
  q#>>'{script_qa,passed}' is distinct from 'true' or coalesce(q->>'script_hash','')!~'^[a-f0-9]{64}$' or coalesce(q->>'policy_hash','')!~'^[a-f0-9]{64}$' then raise check_violation;end if;
 for i in 0..jsonb_array_length(r.state->'tasks')-1 loop
  t:=r.state->'tasks'->i;scene:=s->'scenes'->i;cut:=q->'cuts'->i;
  select x into ref from jsonb_array_elements(r.state#>'{profile,references}') x where x->>'character_id'=scene#>>'{story_visual,speaker_id}';
  if ref is null or scene->>'id' is distinct from 'take_'||i or scene->>'order' is distinct from i::text or
   scene->>'narration_text' is distinct from r.state#>>array['draft','scenes',i::text,'narration_text'] or
   scene->'story_visual' is distinct from r.state#>array['draft','scenes',i::text,'visual'] or
   scene#>'{native_animation}' is distinct from jsonb_build_object('shot_id','take_'||i,'character_id',scene#>>'{story_visual,speaker_id}',
    'reference_sha256',ref->>'sha256','request_key',t->>'request_key','video_sha256',t#>>'{clip,sha256}','frames',(t#>>'{clip,frames}')::int) or
   abs(coalesce((scene->>'duration_seconds')::numeric,0)-(t#>>'{clip,frames}')::numeric/24)>0.000000001 or scene->>'transition' is distinct from 'cut' or scene->>'ken_burns' is distinct from 'static' or
   scene->'asset_landscape' is distinct from 'null'::jsonb or scene#>>'{asset_portrait,url}' is distinct from p_origin||'/storage/v1/object/authenticated/studio-private/'||(t#>>'{clip,path}') or
   cut->>'speaker' is distinct from scene#>>'{story_visual,speaker_id}' or cut->>'source_sha256' is distinct from t#>>'{clip,sha256}' or cut->>'frames' is distinct from t#>>'{clip,frames}' or
   cut->>'original_audio' is distinct from 'true' or cut#>>'{audio_transport,silent_reference}' is distinct from 'false' or
   coalesce((cut#>>'{audio_transport,correlation}')::numeric,0)<0.90 or coalesce(abs((cut#>>'{audio_transport,measured_lag_seconds}')::numeric),1)>0.02 then raise check_violation;end if;
  frames:=frames+(t#>>'{clip,frames}')::int;
 end loop;
 if q->>'frames' is distinct from frames::text or abs(coalesce((q->>'seconds')::numeric,0)-frames::numeric/24)>0.000001 then raise check_violation;end if;
 url:=p_origin||'/storage/v1/object/authenticated/studio-private/'||(r.state#>>'{output,path}');
 if e.status in ('rendered','review') then
  if e.script_json is distinct from s or e.render_url is distinct from url then raise check_violation;end if;
  return '{"code":"saved"}';
 end if;
 if e.status<>'research' then raise check_violation;end if;
 update public.episodes set status='script',script_json=s,script_hash=q->>'script_hash',prompt_version=s->>'prompt_version',
  metadata=coalesce(metadata,'{}')||jsonb_build_object('native_chapter',true,'script_qa',(q->'script_qa')||jsonb_build_object('script_hash',q->>'script_hash','policy_hash',q->>'policy_hash')) where id=e.id;
 update public.episodes set status='assets' where id=e.id;
 update public.episodes set status='rendered',render_url=url,metadata=metadata||jsonb_build_object('render_outputs',jsonb_build_object('portrait',url,'strategy','auray_native_chapter',
   'sha256',r.state#>>'{output,sha256}','seconds',(q->>'seconds')::numeric,'output_fps',24,'width',768,'height',1344,'qa_sha256',r.state#>>'{output,qa_sha256}')) where id=e.id;
 insert into public.job_events(episode_id,event_type,metadata) values(e.id,'qa_passed',jsonb_build_object('scope','native_chapter_assembly','script_hash',q->>'script_hash','policy_hash',q->>'policy_hash','human_review_required',true));
 return '{"code":"saved"}';
end $$;

create or replace function public.save_native_media_review(p_episode uuid,p_report jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs;e public.episodes;t jsonb;i int;
begin
 select * into strict r from public.studio_native_runs where episode_id=p_episode;
 select * into strict e from public.episodes where id=p_episode;
 if e.status not in ('rendered','review') or e.metadata#>>'{render_outputs,sha256}' is distinct from r.state#>>'{output,sha256}' or
  p_report->>'version' is distinct from 'native-media-review-v1' or p_report->>'episode_id' is distinct from e.id::text or
  p_report->>'video_sha256' is distinct from r.state#>>'{output,sha256}' or octet_length(p_report::text)>49152 or
  p_report->>'human_review_required' is distinct from 'true' or p_report->>'lip_sync_verified' is distinct from 'false' or
  p_report->>'identity_verified' is distinct from 'false' or p_report->>'source_video_unchanged' is distinct from 'true' or
  p_report->>'speech_engine' is null or p_report->>'speech_engine' not in ('faster-whisper-base-cpu','unavailable') or
  p_report->>'model_revision' is distinct from 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66' or
  jsonb_typeof(p_report->'takes') is distinct from 'array' or jsonb_array_length(p_report->'takes') is distinct from jsonb_array_length(r.state->'tasks') then raise check_violation;end if;
 if (p_report-array['version','episode_id','video_sha256','created_at','speech_engine','model_revision','human_review_required','lip_sync_verified','identity_verified','source_video_unchanged','takes'])<>'{}' then raise check_violation;end if;
 for i in 0..jsonb_array_length(r.state->'tasks')-1 loop
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
