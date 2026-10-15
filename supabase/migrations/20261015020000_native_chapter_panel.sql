-- Connect reviewed native profiles and durable chapter work to the Studio.
alter table public.studio_native_runs add column closed_at timestamptz;
alter table public.studio_native_runs add column closure_receipt jsonb;
do $$declare constraint_name text;begin
 select conname into strict constraint_name from pg_constraint where conrelid='public.studio_native_runs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%held =%';
 execute format('alter table public.studio_native_runs drop constraint %I',constraint_name);
end $$;
alter table public.studio_native_runs add constraint native_financial_hold check(held=(closed_at is null and state->>'budget_reconciled'='false'));
create table public.studio_native_preparations (
 episode_id uuid primary key references public.episodes(id),workspace_id uuid not null references public.studio_workspaces(id),
 profile_sha256 text not null check(profile_sha256~'^[a-f0-9]{64}$'),fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 draft jsonb not null,dispatched_at timestamptz,attempts int not null default 0,last_code text,
 cancel_requested boolean not null default false,created_at timestamptz not null default now()
);
alter table public.studio_native_preparations enable row level security;
revoke all on public.studio_native_preparations from public,anon,authenticated;
grant all on public.studio_native_preparations to service_role;

alter function public.studio_story_pattern_view(uuid,uuid,uuid,int,text) rename to studio_story_pattern_view_before_native;
revoke all on function public.studio_story_pattern_view_before_native(uuid,uuid,uuid,int,text) from service_role;
create function public.studio_story_pattern_view(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;examples jsonb;
begin
 result:=public.studio_story_pattern_view_before_native(p_workspace,p_actor,p_series,p_revision,p_style);
 select coalesce(jsonb_agg(sample-'bytes'-'sha256' order by created_at,id),'[]') into examples from public.studio_story_style_samples
 where workspace_id=p_workspace and ready and sample->>'source'='auray' and sample->>'style_id'=p_style and sample->>'review_scope'='reviewed_sample' and sample->>'has_audio'='true';
 return result||jsonb_build_object('native_examples',examples,'native_enabled',coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false),
 'can_configure',coalesce((result->>'can_configure')::boolean,false) and (result->>'source'<>'auray' or result->>'voice_policy'='approved_variants'));
end $$;

create function public.studio_native_pattern_finalize(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text,p_profile jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.studio_series;pref public.studio_story_presentations;prior public.studio_story_patterns;c jsonb;r jsonb;v jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 select * into strict s from public.studio_series where id=p_series and workspace_id=p_workspace and archived_at is null for update;
 select * into strict pref from public.studio_story_presentations where series_id=s.id and revision=p_revision;
 select * into prior from public.studio_story_patterns where series_id=s.id and presentation_revision=p_revision and style_id=p_style;
 if found then
  if prior.profile_sha256=p_hash and exists(select 1 from public.studio_series_production where series_id=s.id and profile_sha256=p_hash and profile=p_profile) then return '{"code":"saved"}';end if;
  return '{"code":"locked"}';
 end if;
 if p_revision<>(select max(revision) from public.studio_story_presentations where series_id=s.id) then return '{"code":"style_changed"}';end if;
 if not public.story_pattern_editable(s.id) then return '{"code":"locked"}';end if;
 if pref.preferences->>'source' is distinct from 'auray' or pref.preferences->>'voice_policy' is distinct from 'approved_variants' or not(pref.preferences->'allowed_styles'?p_style) or
  p_style not in ('cinematic_3d','cartoon_2d','anime','realistic') or coalesce(p_hash,'')!~'^[a-f0-9]{64}$' or p_profile->>'version' is distinct from 'auray-native-1.0.0' or
  p_profile->>'model' is distinct from 'auray-ai/minimax-h3/text-to-video' or p_profile->>'contract_sha256' is distinct from '365a74a0aeab67eebf117fd826d540017748d687ba0955fc8ed989d113a816f1' or
  p_profile->>'orientation' is distinct from 'portrait' or p_profile->>'width' is distinct from '768' or p_profile->>'height' is distinct from '1344' or p_profile->>'output_fps' is distinct from '24' or
  p_profile->>'voice_policy' is distinct from 'provider_generated_review' or p_profile->>'native_voice_acknowledged' is distinct from 'true' or
  coalesce(char_length(p_profile->>'style'),0) not between 30 and 700 or jsonb_array_length(p_profile->'references') is distinct from jsonb_array_length(s.bible->'cast') or
  jsonb_array_length(p_profile->'voice_directions') is distinct from jsonb_array_length(s.bible->'cast') then raise check_violation;end if;
 if not exists(select 1 from public.studio_story_style_samples where workspace_id=p_workspace and id=(p_profile#>>'{example,id}')::uuid and ready and sample->>'sha256'=p_profile#>>'{example,sha256}' and
  sample->>'source'='auray' and sample->>'style_id'=p_style and sample->>'has_audio'='true' and sample->>'review_scope'='reviewed_sample') then raise check_violation;end if;
 for c in select value from jsonb_array_elements(s.bible->'cast') loop
  select value into r from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id';
  select value into v from jsonb_array_elements(p_profile->'voice_directions') where value->>'character_id'=c->>'id';
  if r is null or v is null or coalesce(char_length(v->>'description'),0) not between 20 and 240 or
   (select count(*) from jsonb_array_elements(p_profile->'references') where value->>'character_id'=c->>'id')<>1 or
   (select count(*) from jsonb_array_elements(p_profile->'voice_directions') where value->>'character_id'=c->>'id')<>1 or
   not exists(select 1 from public.studio_production_media where series_id=s.id and workspace_id=p_workspace and character_id=c->>'id' and kind='reference' and ready and path=r->>'path' and sha256=r->>'sha256') then raise check_violation;end if;
 end loop;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256,legacy_identity) values(s.id,p_workspace,p_profile,p_hash,false) on conflict do nothing;
 if not exists(select 1 from public.studio_series_production where series_id=s.id and workspace_id=p_workspace and profile_sha256=p_hash and profile=p_profile) then raise check_violation;end if;
 insert into public.studio_story_patterns values(s.id,p_revision,p_style,p_hash,p_actor,now());
 return '{"code":"saved"}';
end $$;

create function public.save_native_draft(p_episode uuid,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
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
 if e.status<>'research' or coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' or octet_length(p_draft::text)>32768 or jsonb_array_length(p_draft->'scenes') is distinct from 3 or
  not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) then raise check_violation;end if;
 insert into public.studio_native_preparations(episode_id,workspace_id,profile_sha256,fingerprint,draft) values(e.id,e.workspace_id,p_profile,p_fingerprint,p_draft);
 update public.episodes set metadata=coalesce(metadata,'{}')||'{"native_chapter":true}' where id=e.id;
 return '{"code":"prepared"}';
end $$;

create function public.native_worker_input(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.studio_native_preparations;e public.episodes;wallet uuid;
begin
 select * into strict e from public.episodes where id=p_episode;
 if exists(select 1 from public.studio_native_runs where episode_id=e.id) then return '{"code":"existing"}';end if;
 select * into strict p from public.studio_native_preparations where episode_id=e.id;
 if p.cancel_requested or e.status<>'research' then return '{"code":"cancelled"}';end if;
 if not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
 select c.wallet_id into wallet from public.studio_auray_config c join public.studio_video_wallet_access a on a.wallet_id=c.wallet_id
 where a.workspace_id=e.workspace_id and not exists(select 1 from public.studio_native_runs r where r.wallet_id=c.wallet_id and held)
 order by least((c.observation->>'plan_remaining')::bigint,(c.observation->>'key_remaining')::bigint) desc nulls last,c.wallet_id limit 1;
 if wallet is null then return '{"code":"wallet_reserved"}';end if;
 return jsonb_build_object('code','prepare','wallet_id',wallet,'context',e.briefing->'story_context','profile',public.studio_story_episode_profile(e.id)->'profile','draft',p.draft,'fingerprint',p.fingerprint);
end $$;

create function public.studio_native_step(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.studio_native_preparations;e public.episodes;r public.studio_native_runs;
begin
 select * into strict e from public.episodes where id=p_episode for update;
 select * into strict p from public.studio_native_preparations where episode_id=e.id for update;
 select * into r from public.studio_native_runs where episode_id=e.id;
 if r.closed_at is not null or e.status<>'research' then return '{"code":"finished"}';end if;
 if not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) and r.episode_id is null then return '{"code":"native_setup_required"}';end if;
 if r.episode_id is not null and exists(select 1 from public.studio_auray_config where wallet_id=r.wallet_id and lease_until>now()) then return '{"code":"waiting_for_runner"}';end if;
 if p.dispatched_at>now()-interval '40 minutes' then return '{"code":"waiting_for_runner"}';end if;
 if p.attempts>=100 then return '{"code":"operator_required"}';end if;
 update public.studio_native_preparations set dispatched_at=now(),attempts=attempts+1 where episode_id=e.id;
 return '{"code":"dispatch"}';
end $$;

create function public.native_worker_result(p_episode uuid,p_code text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(p_code,'')!~'^[a-z_]{1,80}$' then raise check_violation;end if;
 update public.studio_native_preparations set last_code=p_code where episode_id=p_episode;
end $$;

create function public.native_recovery_episodes() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(episode_id),'[]') from (select r.episode_id from public.studio_native_runs r join public.studio_native_preparations p using(episode_id)
 where r.held and r.closed_at is null and (p.cancel_requested or r.state->'output' is distinct from 'null'::jsonb) order by r.updated_at limit 3) pending
$$;
revoke all on function public.native_recovery_episodes() from public,anon,authenticated;
grant execute on function public.native_recovery_episodes() to service_role;

create function public.studio_native_action(p_workspace uuid,p_actor uuid,p_episode uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.studio_native_preparations;r public.studio_native_runs;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.episodes where id=p_episode and workspace_id=p_workspace and status='research' for update;
 if not found then return '{"code":"finished"}';end if;
 select * into strict p from public.studio_native_preparations where episode_id=p_episode for update;
 select * into r from public.studio_native_runs where episode_id=p_episode;
 if p_action not in ('resume','cancel') then raise check_violation;end if;
 if r.closed_at is not null then return '{"code":"finished"}';end if;
 if p_action='cancel' then
  update public.studio_native_preparations set cancel_requested=true,last_code='cancellation_pending' where episode_id=p_episode;
  if r.episode_id is null then
   update public.episodes set status='failed',failure_reason='native_chapter_cancelled_before_submission' where id=p_episode;
   return '{"code":"cancelled"}';
  end if;
 end if;
 if r.episode_id is not null and exists(select 1 from public.studio_auray_config where wallet_id=r.wallet_id and lease_until>now()) then return '{"code":"waiting_for_runner"}';end if;
 if p.dispatched_at>now()-interval '2 minutes' then return '{"code":"waiting_for_runner"}';end if;
 update public.studio_native_preparations set dispatched_at=null where episode_id=p_episode;
 return public.studio_native_step(p_episode);
end $$;

create or replace function public.guard_native_chapter(p_episode uuid,p_token uuid,p_submission boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.studio_auray_config c join public.studio_native_runs r on r.wallet_id=c.wallet_id
 where r.episode_id=p_episode and r.closed_at is null and c.lease_token=p_token and c.lease_until>now() for update of c;
 if not found then raise insufficient_privilege;end if;
 if p_submission and (not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) or
  exists(select 1 from public.studio_native_preparations where episode_id=p_episode and cancel_requested) or
  not exists(select 1 from public.studio_native_runs r join public.episodes e on e.id=r.episode_id where r.episode_id=p_episode and r.held and e.status='research')) then raise check_violation;end if;
 update public.studio_auray_config c set lease_until=now()+interval '5 minutes' from public.studio_native_runs r where r.episode_id=p_episode and r.wallet_id=c.wallet_id and c.lease_token=p_token;
end $$;

create function public.native_cancellation_pending(p_episode uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.guard_native_chapter(p_episode,p_token);
 return coalesce((select cancel_requested from public.studio_native_preparations where episode_id=p_episode),false);
end $$;

create function public.close_native_chapter(p_episode uuid,p_token uuid,p_proof jsonb) returns jsonb
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

-- Grants for new functions; existing replacements retain their previous grants.
revoke all on function public.studio_story_pattern_view(uuid,uuid,uuid,int,text),public.studio_native_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text),public.save_native_draft(uuid,text,text,jsonb),public.native_worker_input(uuid),public.studio_native_step(uuid),public.native_worker_result(uuid,text),public.studio_native_action(uuid,uuid,uuid,text),public.native_cancellation_pending(uuid,uuid),public.close_native_chapter(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_story_pattern_view(uuid,uuid,uuid,int,text),public.studio_native_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text),public.save_native_draft(uuid,text,text,jsonb),public.native_worker_input(uuid),public.studio_native_step(uuid),public.native_worker_result(uuid,text),public.studio_native_action(uuid,uuid,uuid,text),public.native_cancellation_pending(uuid,uuid),public.close_native_chapter(uuid,uuid,jsonb) to service_role;

create or replace function public.claim_native_chapter(p_episode uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs;c public.studio_auray_config;
begin
 select * into strict r from public.studio_native_runs where episode_id=p_episode;
 select * into strict c from public.studio_auray_config where wallet_id=r.wallet_id for update;
 if c.lease_until>now() then return '{"code":"waiting"}';end if;
 select * into strict r from public.studio_native_runs where episode_id=p_episode;
 if r.closed_at is not null then return '{"code":"closed"}';end if;
 update public.studio_auray_config set lease_token=p_token,lease_until=now()+interval '5 minutes' where wallet_id=r.wallet_id;
 return jsonb_build_object('code','claimed','state',r.state);
end $$;

alter function public.studio_story_manage(uuid,uuid,uuid,text) rename to studio_story_manage_before_native;
revoke all on function public.studio_story_manage_before_native(uuid,uuid,uuid,text) from service_role;
create function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ep uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 select i.episode_id into ep from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id where c.series_id=p_series and c.workspace_id=p_workspace order by c.chapter_number desc limit 1;
 if p_action='retry' and ep is not null and (public.studio_story_episode_profile(ep)#>>'{profile,version}')='auray-native-1.0.0' then
  if exists(select 1 from public.studio_native_runs where episode_id=ep and held) then return '{"code":"existing_native_work"}';end if;
  return public.studio_story_manage_illustrated(p_workspace,p_actor,p_series,p_action);
 end if;
 return public.studio_story_manage_before_native(p_workspace,p_actor,p_series,p_action);
end $$;
revoke all on function public.studio_story_manage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_manage(uuid,uuid,uuid,text) to service_role;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_native_panel;
revoke all on function public.studio_video_overview_before_native_panel(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
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
  'total_shots',3,'planned_seconds',15,'output_fps',24,'stage',case when r.closed_at is not null or p.cancel_requested and e.status='failed' then 'cancelled' when p.cancel_requested then 'cancellation_pending'
   when e.status in ('rendered','review','published','analyze') then e.status when r.state->'output' is distinct from 'null'::jsonb and r.state->'output' is not null then 'ready_for_assembly'
   when exists(select 1 from jsonb_array_elements(coalesce(r.state->'tasks','[]')) x where x->>'phase' in ('failed','rejected','submission_unknown')) then 'reconciliation_required'
   when r.episode_id is null then 'awaiting_capacity' else 'generating_clips' end,'last_code',p.last_code,'cancel_requested',p.cancel_requested,'closed',r.closed_at is not null or p.cancel_requested and e.status='failed')
  order by p.created_at),'[]') into progress from public.studio_native_preparations p join public.episodes e on e.id=p.episode_id left join public.studio_native_runs r on r.episode_id=p.episode_id where p.workspace_id=p_workspace;
 return jsonb_set(result,'{wallets}',wallets)||jsonb_build_object('native_enabled',enabled,'native_chapters',progress);
end $$;
revoke all on function public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_overview(uuid,uuid) to service_role;

create or replace function public.story_pattern_editable(p_series uuid) returns boolean language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.studio_story_presentations p join public.studio_series s on s.id=p.series_id
 where s.id=p_series and s.archived_at is null and p.revision=(select max(revision) from public.studio_story_presentations where series_id=s.id)
 and (p.preferences->>'source' in ('automatic','modal') or (p.preferences->>'source'='auray' and p.preferences->>'voice_policy'='approved_variants'))
 and exists(select 1 from jsonb_array_elements_text(p.preferences->'allowed_styles') x where x in ('cinematic_3d','cartoon_2d','anime','realistic')
  and not exists(select 1 from public.studio_story_patterns v where v.series_id=s.id and v.presentation_revision=p.revision and v.style_id=x))
 and not exists(select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id left join public.episodes e on e.id=i.episode_id
  where c.series_id=s.id and (i.status='pending' or e.id is null or e.status in ('idea','research','script','assets','rendered','failed') or not exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e))))
 and coalesce((select max(chapter_number) from public.studio_story_chapters where series_id=s.id),0)<jsonb_array_length(s.bible->'chapters'));
$$;

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
   if chosen not in ('cinematic_3d','cartoon_2d','anime','realistic') or pref.preferences->>'source' not in ('automatic','modal','auray') then return '{"code":"style_preparation_required"}';end if;
   if pref.preferences->>'source'='auray' and pref.preferences->>'voice_policy'<>'approved_variants' then return '{"code":"style_preparation_required"}';end if;
   select profile_sha256 into profile_hash from public.studio_story_patterns where series_id=p_series and presentation_revision=pref.revision and style_id=chosen;
   if not found then return '{"code":"profile_incomplete"}';end if;
   if pref.preferences->>'source'='auray' then
    if pref.preferences->>'voice_policy'<>'approved_variants' or not exists(select 1 from public.studio_series_production where series_id=p_series and profile_sha256=profile_hash and profile->>'version'='auray-native-1.0.0') then return '{"code":"native_voice_consent_required"}';end if;
    if not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
   else
    if exists(select 1 from public.studio_series_production where series_id=p_series and profile_sha256=profile_hash and profile->>'version'='auray-native-1.0.0') then return '{"code":"style_preparation_required"}';end if;
    if not coalesce((select value->>'animated_preparation_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"animation_setup_required"}';end if;
   end if;
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
  if i>0 and (p_state->'tasks'->(i-1)->>'phase')<>'ready' and b->>'phase'<>'planned' then raise check_violation;end if;
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

update public.studio_video_wallets set label='Auray · créditos gratuitos' where label='Auray · em avaliação' and id in(select wallet_id from public.studio_auray_config);
