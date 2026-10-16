-- A repair is a new, explicit chapter attempt: one new shot and two immutable copies.
create table public.studio_native_repairs(
 request_id uuid primary key,workspace_id uuid not null references public.studio_workspaces(id),actor uuid not null,
 source_episode uuid not null references public.episodes(id),episode_id uuid not null unique references public.episodes(id),
 shot_index int not null check(shot_index between 0 and 2),input jsonb not null,restored_at timestamptz,created_at timestamptz not null default now()
);
alter table public.studio_native_repairs enable row level security;
revoke all on public.studio_native_repairs from public,anon,authenticated;
grant all on public.studio_native_repairs to service_role;
do $$declare name text;begin
 select conname into strict name from pg_constraint where conrelid='public.studio_native_runs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reserved_credits%';
 execute format('alter table public.studio_native_runs drop constraint %I',name);
end $$;
alter table public.studio_native_runs add check(state->>'reserved_credits' in ('5','15'));

create function public.studio_native_repair_view(p_workspace uuid,p_actor uuid,p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;r public.studio_native_runs;ch public.studio_story_chapters;can_edit boolean;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select * into strict e from public.episodes where id=p_episode and workspace_id=p_workspace;
 select * into r from public.studio_native_runs where episode_id=e.id;
 select c.* into ch from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id where i.episode_id=e.id;
 can_edit:=ch.series_id is not null and r.episode_id is not null and not r.held and r.state->'output' is distinct from 'null'::jsonb and e.status='review' and
  not exists(select 1 from public.studio_story_chapters where series_id=ch.series_id and chapter_number>ch.chapter_number);
 return jsonb_build_object('available',r.episode_id is not null,'can_repair',coalesce(can_edit,false),'draft',r.state->'draft','context',r.state->'context','profile',r.state->'profile',
 'versions',coalesce((select jsonb_agg(jsonb_build_object('source_episode',source_episode,'episode_id',episode_id,'shot_index',shot_index,'restored',restored_at is not null,'created_at',created_at) order by created_at desc) from public.studio_native_repairs where workspace_id=p_workspace and (source_episode=e.id or episode_id=e.id)),'[]'));
end $$;

create function public.studio_native_repair_prepare(p_workspace uuid,p_actor uuid,p_episode uuid,p_request uuid,p_edit jsonb,p_draft jsonb,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;r public.studio_native_runs;ch public.studio_story_chapters;i public.idea_queue;new_idea uuid;new_episode uuid;
 prior public.studio_native_repairs;idx int;new_shot int;reply jsonb;before jsonb;after jsonb;
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
 if coalesce((p_edit->>'index')::int,-1) not between 0 and 2 or coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' or octet_length(p_draft::text)>32768 or
  p_draft-array['scenes','summary'] is distinct from (r.state->'draft')-array['scenes','summary'] or jsonb_array_length(p_draft->'scenes') is distinct from 3 or
  p_draft->>'summary' is distinct from p_edit->>'summary' then raise check_violation;end if;
 new_shot:=(p_edit->>'index')::int;
 for idx in 0..2 loop
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

create function public.studio_native_repair_restore(p_workspace uuid,p_actor uuid,p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_repairs;e public.episodes;old_idea uuid;ch public.studio_story_chapters;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict r from public.studio_native_repairs where episode_id=p_episode and workspace_id=p_workspace for update;
 if r.restored_at is not null then return '{"code":"restored"}';end if;
 select * into strict e from public.episodes where id=r.episode_id for update;
 select c.* into ch from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id where i.episode_id=e.id for update of c;
 if ch.series_id is null or e.status not in ('review','failed') or exists(select 1 from public.studio_native_runs where episode_id=e.id and held) or
  exists(select 1 from public.studio_story_chapters where series_id=ch.series_id and chapter_number>ch.chapter_number) or
  exists(select 1 from public.review_requests q where q.episode_id=e.id and q.decision='approved' and q.fingerprint=public.review_fingerprint(e)) then return '{"code":"repair_locked"}';end if;
 select id into strict old_idea from public.idea_queue where episode_id=r.source_episode;
 update public.studio_story_chapters set idea_id=old_idea where series_id=ch.series_id and chapter_number=ch.chapter_number;
 update public.studio_native_repairs set restored_at=now() where request_id=r.request_id;
 return '{"code":"restored"}';
end $$;

alter function public.native_worker_input(uuid) rename to native_worker_input_before_repair;
revoke all on function public.native_worker_input_before_repair(uuid) from service_role;
create function public.native_worker_input(p_episode uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;r public.studio_native_repairs;s public.studio_native_runs;reuse jsonb;
begin
 result:=public.native_worker_input_before_repair(p_episode);
 if result->>'code'<>'prepare' then return result;end if;
 select * into r from public.studio_native_repairs where episode_id=p_episode and restored_at is null;
 if not found then return result;end if;
 select * into strict s from public.studio_native_runs where episode_id=r.source_episode and not held and workspace_id=r.workspace_id;
 if exists(select 1 from public.studio_native_runs where wallet_id=s.wallet_id and held) then return '{"code":"wallet_reserved"}';end if;
 if s.state->'profile' is distinct from result->'profile' or s.state->'context' is distinct from result->'context' then raise check_violation;end if;
 select jsonb_agg(jsonb_build_object('index',idx,'episode_id',s.episode_id,'clip',s.state->'tasks'->idx->'clip') order by idx) into reuse from generate_series(0,2) idx where idx<>r.shot_index;
 return result||jsonb_build_object('reuse',reuse,'wallet_id',s.wallet_id);
end $$;
revoke all on function public.studio_native_repair_view(uuid,uuid,uuid),public.studio_native_repair_prepare(uuid,uuid,uuid,uuid,jsonb,jsonb,text),public.studio_native_repair_restore(uuid,uuid,uuid),public.native_worker_input(uuid) from public,anon,authenticated;
grant execute on function public.studio_native_repair_view(uuid,uuid,uuid),public.studio_native_repair_prepare(uuid,uuid,uuid,uuid,jsonb,jsonb,text),public.studio_native_repair_restore(uuid,uuid,uuid),public.native_worker_input(uuid) to service_role;

create or replace function public.reserve_native_chapter(p_episode uuid,p_wallet uuid,p_run jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes; c public.studio_auray_config; profile jsonb; pref jsonb; prior public.studio_native_runs; task jsonb; stamp timestamptz; repair public.studio_native_repairs; origin public.studio_native_runs; needed int:=15; idx int:=0; reused jsonb;
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
  jsonb_typeof(p_run->'tasks') is distinct from 'array' or jsonb_array_length(p_run->'tasks')<>3 then raise check_violation;end if;
 for task in select value from jsonb_array_elements(p_run->'tasks') loop
  if coalesce(task->>'request_key','')!~'^[a-f0-9]{64}$' or task->>'job_id' is distinct from 'video_'||(task->>'request_key') then raise check_violation;end if;
  if repair.episode_id is not null and idx<>repair.shot_index then
   reused:=jsonb_build_object('index',idx,'episode_id',origin.episode_id,'clip',origin.state->'tasks'->idx->'clip');
   if task->'reused' is distinct from reused or task->>'phase' is distinct from 'ready' or task->>'settled' is distinct from 'true' or task->>'charged_credits' is distinct from '0' or
    task->'clip' is distinct from ((origin.state->'tasks'->idx->'clip')||jsonb_build_object('request_key',task->>'request_key','path','episodes/'||p_episode||'/native/'||(reused#>>'{clip,sha256}')||'.mp4')) then raise check_violation;end if;
  elsif task ? 'reused' or task->>'phase' is distinct from 'planned' or task->>'charged_credits' is distinct from '0' or task->>'settled' is distinct from 'false' or task->'clip' is distinct from 'null'::jsonb then raise check_violation;end if;
  idx:=idx+1;
 end loop;
 if (select count(distinct value->>'request_key') from jsonb_array_elements(p_run->'tasks'))<>3 then raise check_violation;end if;
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
  jsonb_typeof(p_state->'tasks') is distinct from 'array' or jsonb_array_length(p_state->'tasks')<>3 then raise check_violation;end if;
 for i in 0..2 loop
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

create or replace function public.close_native_chapter(p_episode uuid,p_token uuid,p_proof jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs;t jsonb;j jsonb;charged int:=0;
begin
 perform public.guard_native_chapter(p_episode,p_token);
 select * into strict r from public.studio_native_runs where episode_id=p_episode for update;
 if not exists(select 1 from public.studio_native_preparations where episode_id=p_episode and cancel_requested) then raise check_violation;end if;
 if p_proof->>'account_id' is distinct from r.state->>'account_id' or p_proof->>'key_id' is distinct from r.state->>'key_id' or p_proof->>'trustworthy' is distinct from 'true' or
  p_proof->>'checked_at' is null or (p_proof->>'checked_at')::timestamptz not between now()-interval '2 minutes' and now()+interval '5 seconds' or
  jsonb_typeof(p_proof->'jobs') is distinct from 'array' or p_proof->>'period' is distinct from to_char(now() at time zone 'UTC','YYYY-MM') then raise check_violation;end if;
 for t in select value from jsonb_array_elements(r.state->'tasks') where value->>'phase'<>'planned' loop
  if t ? 'reused' then continue;end if;
  select x into j from jsonb_array_elements(p_proof->'jobs') x where x->>'id'=t->>'job_id';
  if t->>'phase'='rejected' and t->>'charged_credits'='0' and t->>'error_code' in ('rate_limited','quota_exhausted','access_denied','financial_gate_closed','inspection_required') and
   j->>'status'='rejected' and j->>'no_acceptance'='true' and j->>'settled'='true' and j->>'credits_charged'='0' then continue;end if;
  if j is null or j->>'settled' is distinct from 'true' or coalesce(j->>'status','') not in ('succeeded','failed','cancelled') or
   coalesce((j->>'credits_charged')::int,-1) not between (t->>'charged_credits')::int and 5 then return '{"code":"cancellation_pending"}';end if;
  charged:=charged+(j->>'credits_charged')::int;
 end loop;
 if p_proof->>'period'=r.state->>'period' and (coalesce((p_proof->>'plan_remaining')::int,2147483647)>(r.state->>'initial_plan_remaining')::int-charged or
  coalesce((p_proof->>'key_remaining')::int,2147483647)>(r.state->>'initial_key_remaining')::int-charged) then return '{"code":"billing_pending"}';end if;
 update public.studio_native_runs set closed_at=now(),closure_receipt=p_proof,held=false where episode_id=p_episode;
 update public.episodes set status='failed',failure_reason='native_chapter_cancelled_after_reconciliation' where id=p_episode and status='research';
 update public.studio_native_preparations set last_code='cancelled' where episode_id=p_episode;
 update public.studio_video_wallets set valid_until=null where id=r.wallet_id;
 return '{"code":"cancelled"}';
end $$;

create or replace function public.studio_video_overview_before_native_panel(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;wallets jsonb;
begin
 result:=public.studio_video_overview_before_native(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||case when c.wallet_id is null then '{}'::jsonb else jsonb_build_object(
  'native_reserved_credits',coalesce(h.units,0),'reserved_units',coalesce((v->>'reserved_units')::bigint,0)+coalesce(h.units,0),
  'budget_only_shots',case when v->>'budget_only_shots' is not null then greatest(0,(v->>'budget_only_shots')::int-coalesce(h.units,0)/5) else null end
 ) end order by v->>'label'),'[]') into wallets from jsonb_array_elements(result->'wallets') v
 left join public.studio_auray_config c on c.wallet_id=(v->>'id')::uuid
 left join lateral(select sum((r.state->>'reserved_credits')::int)::int units from public.studio_native_runs r where r.wallet_id=c.wallet_id and held) h on true;
 return jsonb_set(result,'{wallets}',wallets);
end $$;
