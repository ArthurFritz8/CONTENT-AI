-- Puter native chapters use a separate free account hold and immutable 30 FPS profile.
create table public.studio_puter_preparations (like public.studio_native_preparations including defaults including constraints including indexes);
alter table public.studio_puter_preparations add foreign key(episode_id) references public.episodes(id);
alter table public.studio_puter_preparations add foreign key(workspace_id) references public.studio_workspaces(id);
create table public.studio_puter_runs(
 episode_id uuid primary key references public.episodes(id), workspace_id uuid not null references public.studio_workspaces(id),
 account_id uuid not null references public.studio_puter_accounts(id), state jsonb not null,
 held boolean not null default true, closed_at timestamptz, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(held=(closed_at is null and state->>'budget_reconciled'='false')),
 check(state->>'provider'='puter' and state->>'reserved_credits'='990'),
 check(jsonb_array_length(state->'tasks')=3 and public.native_chapter_shots(state->'context')=3)
);
create unique index studio_puter_account_hold on public.studio_puter_runs(account_id) where held;
alter table public.studio_puter_preparations enable row level security;
alter table public.studio_puter_runs enable row level security;
revoke all on public.studio_puter_preparations,public.studio_puter_runs from public,anon,authenticated;
grant all on public.studio_puter_preparations,public.studio_puter_runs to service_role;


create or replace function public.valid_story_presentation(p jsonb) returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['version','primary_style','continuity_mode','allowed_styles','source','voice_policy']) then return false; end if;
 if (select count(*) from jsonb_object_keys(p))<>6 or p->>'version' is distinct from '1.0.0' or
  coalesce(p->>'primary_style','') not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic') or
  coalesce(p->>'continuity_mode','') not in ('fixed','per_chapter') or coalesce(p->>'source','') not in ('automatic','modal','auray','puter','local') or
  coalesce(p->>'voice_policy','') not in ('preserve','approved_variants') or jsonb_typeof(p->'allowed_styles') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p->'allowed_styles') not between 1 and 6 or not((p->'allowed_styles') ? (p->>'primary_style')) or
  (p->>'continuity_mode'='fixed' and jsonb_array_length(p->'allowed_styles')<>1) or
  exists(select 1 from jsonb_array_elements_text(p->'allowed_styles') s where s not in ('illustrated','cinematic_3d','cartoon_2d','anime','realistic','motion_comic')) or
  (select count(distinct s) from jsonb_array_elements_text(p->'allowed_styles') s)<>jsonb_array_length(p->'allowed_styles') then return false; end if;
 return true;
end $$;

create or replace function public.story_pattern_editable(p_series uuid) returns boolean language sql stable set search_path=public,pg_temp as $$
 select exists(select 1 from public.studio_story_presentations p join public.studio_series s on s.id=p.series_id
 where s.id=p_series and s.archived_at is null and p.revision=(select max(revision) from public.studio_story_presentations where series_id=s.id)
 and (p.preferences->>'source' in ('automatic','modal') or (p.preferences->>'source' in ('auray','puter') and p.preferences->>'voice_policy'='approved_variants'))
 and exists(select 1 from jsonb_array_elements_text(p.preferences->'allowed_styles') x where x in ('cinematic_3d','cartoon_2d','anime','realistic')
  and not exists(select 1 from public.studio_story_patterns v where v.series_id=s.id and v.presentation_revision=p.revision and v.style_id=x))
 and not exists(select 1 from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id left join public.episodes e on e.id=i.episode_id
  where c.series_id=s.id and (i.status='pending' or e.id is null or e.status in ('idea','research','script','assets','rendered','failed') or not exists(select 1 from public.review_requests r where r.episode_id=e.id and r.decision='approved' and r.fingerprint=public.review_fingerprint(e))))
 and coalesce((select max(chapter_number) from public.studio_story_chapters where series_id=s.id),0)<jsonb_array_length(s.bible->'chapters'));
$$;

create or replace function public.studio_story_pattern_view(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;examples jsonb;
begin
 result:=public.studio_story_pattern_view_before_native(p_workspace,p_actor,p_series,p_revision,p_style);
 select coalesce(jsonb_agg(sample-'bytes'-'sha256' order by created_at,id),'[]') into examples from public.studio_story_style_samples
 where workspace_id=p_workspace and ready and sample->>'source'=result->>'source' and sample->>'style_id'=p_style and sample->>'review_scope'='reviewed_sample' and sample->>'has_audio'='true';
 return result||jsonb_build_object('native_examples',examples,'native_enabled',coalesce((select value->>(case when result->>'source'='puter' then 'puter_chapter_enabled' else 'native_chapter_enabled' end)='true' from public.system_config where key='story_production'),false),
 'can_configure',coalesce((result->>'can_configure')::boolean,false) and (result->>'source' not in ('auray','puter') or result->>'voice_policy'='approved_variants'));
end $$;

create function public.studio_puter_pattern_finalize(p_workspace uuid,p_actor uuid,p_series uuid,p_revision int,p_style text,p_profile jsonb,p_hash text) returns jsonb
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
 if pref.preferences->>'source' is distinct from 'puter' or pref.preferences->>'voice_policy' is distinct from 'approved_variants' or not(pref.preferences->'allowed_styles'?p_style) or
  p_style not in ('cinematic_3d','cartoon_2d','anime','realistic') or coalesce(p_hash,'')!~'^[a-f0-9]{64}$' or p_profile->>'version' is distinct from 'puter-native-1.0.0' or
  p_profile->>'model' is distinct from 'togetherai:wan-ai/wan2.7-i2v' or p_profile->>'contract_sha256' is distinct from 'af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364' or
  p_profile->>'orientation' is distinct from 'portrait' or p_profile->>'width' is distinct from '720' or p_profile->>'height' is distinct from '1280' or p_profile->>'output_fps' is distinct from '30' or
  p_profile->>'voice_policy' is distinct from 'provider_generated_review' or p_profile->>'native_voice_acknowledged' is distinct from 'true' or
  coalesce(char_length(p_profile->>'style'),0) not between 30 and 700 or jsonb_array_length(p_profile->'references') is distinct from jsonb_array_length(s.bible->'cast') or
  jsonb_array_length(p_profile->'voice_directions') is distinct from jsonb_array_length(s.bible->'cast') then raise check_violation;end if;
 if not exists(select 1 from public.studio_story_style_samples where workspace_id=p_workspace and id=(p_profile#>>'{example,id}')::uuid and ready and sample->>'sha256'=p_profile#>>'{example,sha256}' and
  sample->>'source'='puter' and sample->>'style_id'=p_style and sample->>'has_audio'='true' and sample->>'review_scope'='reviewed_sample') then raise check_violation;end if;
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
   if chosen not in ('cinematic_3d','cartoon_2d','anime','realistic') or pref.preferences->>'source' not in ('automatic','modal','auray','puter') then return '{"code":"style_preparation_required"}';end if;
   if pref.preferences->>'source' in ('auray','puter') and pref.preferences->>'voice_policy'<>'approved_variants' then return '{"code":"style_preparation_required"}';end if;
   select profile_sha256 into profile_hash from public.studio_story_patterns where series_id=p_series and presentation_revision=pref.revision and style_id=chosen;
   if not found then return '{"code":"profile_incomplete"}';end if;
   if pref.preferences->>'source' in ('auray','puter') then
    if pref.preferences->>'voice_policy'<>'approved_variants' or not exists(select 1 from public.studio_series_production where series_id=p_series and profile_sha256=profile_hash and profile->>'version'=case when pref.preferences->>'source'='puter' then 'puter-native-1.0.0' else 'auray-native-1.0.0' end) then return '{"code":"native_voice_consent_required"}';end if;
    if not coalesce((select value->>(case when pref.preferences->>'source'='puter' then 'puter_chapter_enabled' else 'native_chapter_enabled' end)='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
    if pref.preferences->>'source'='puter' and not exists(select 1 from jsonb_array_elements(public.studio_puter_view(p_workspace,p_actor)->'accounts') a
      where a->>'balance_fresh'='true' and a->>'financially_eligible'='true' and (a->>'estimated_chapters')::int>=1 and
      (select native_shots from public.studio_series where id=p_series)=3) then return '{"code":"complete_chapter_budget_required"}';end if;
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

create or replace function public.save_puter_draft(p_episode uuid,p_profile text,p_fingerprint text,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;prior public.studio_puter_preparations;
begin
 select * into strict e from public.episodes where id=p_episode for update;
 if public.story_episode_profile_hash(e.id) is distinct from p_profile or (public.studio_story_episode_profile(e.id)#>>'{profile,version}') is distinct from 'puter-native-1.0.0' then raise check_violation;end if;
 select * into prior from public.studio_puter_preparations where episode_id=e.id;
 if found then
  if prior.profile_sha256<>p_profile or prior.fingerprint<>p_fingerprint or prior.draft<>p_draft then raise check_violation;end if;
  return '{"code":"prepared"}';
 end if;
 if e.status<>'research' or coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' or octet_length(p_draft::text)>32768 or jsonb_array_length(p_draft->'scenes') is distinct from public.native_chapter_shots(e.briefing->'story_context') or
  not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) then raise check_violation;end if;
 insert into public.studio_puter_preparations(episode_id,workspace_id,profile_sha256,fingerprint,draft) values(e.id,e.workspace_id,p_profile,p_fingerprint,p_draft);
 update public.episodes set metadata=coalesce(metadata,'{}')||'{"puter_chapter":true}' where id=e.id;
 return '{"code":"prepared"}';
end $$;

create function public.puter_worker_input(p_episode uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;p public.studio_puter_preparations; a uuid;r public.studio_puter_runs;
begin
 select * into strict e from public.episodes where id=p_episode;
 select * into strict p from public.studio_puter_preparations where episode_id=e.id;
 select * into r from public.studio_puter_runs where episode_id=e.id;
 if r.closed_at is not null or e.status<>'research' then return '{"code":"finished"}';end if;
 if r.episode_id is not null then return jsonb_build_object('code','prepare','account_id',r.account_id,'state',r.state);end if;
 if p.cancel_requested then return '{"code":"cancelled"}';end if;
 if not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
 select x.account_id into a from public.studio_puter_access x join public.studio_puter_accounts c on c.id=x.account_id where x.workspace_id=e.workspace_id
 and not exists(select 1 from public.studio_puter_runs r where r.account_id=c.id and held)
 order by (c.observation->>'financially_eligible'='true') desc nulls last,(c.observation->>'remaining_credits')::numeric desc nulls last,c.observed_at desc nulls last,c.id limit 1;
 if a is null then return '{"code":"connection_required"}';end if;
 return jsonb_build_object('code','prepare','account_id',a,'context',e.briefing->'story_context','profile',public.studio_story_episode_profile(e.id)->'profile','draft',p.draft,'fingerprint',p.fingerprint);
end $$;

create function public.claim_puter_chapter(p_episode uuid,p_account uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.studio_puter_accounts;e public.episodes;credential text;
begin
 select * into strict e from public.episodes where id=p_episode;
 if not exists(select 1 from public.studio_puter_preparations where episode_id=e.id) or not exists(select 1 from public.studio_puter_access where workspace_id=e.workspace_id and account_id=p_account) then raise insufficient_privilege;end if;
 select * into strict a from public.studio_puter_accounts where id=p_account for update;
 if a.lease_until>now() or exists(select 1 from public.studio_puter_runs where account_id=a.id and held and episode_id<>e.id) then return '{"code":"account_busy"}';end if;
 if exists(select 1 from public.studio_puter_runs where episode_id=e.id and account_id<>a.id) then raise insufficient_privilege;end if;
 if e.status<>'research' or exists(select 1 from public.studio_puter_runs where episode_id=e.id and closed_at is not null) then return '{"code":"finished"}';end if;
 if p_token is null then raise check_violation;end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into credential using a.secret_id;
 if credential is null then return '{"code":"connection_required"}';end if;
 update public.studio_puter_accounts set lease_token=p_token,lease_until=now()+interval '15 minutes' where id=a.id;
 return jsonb_build_object('code','claimed','credential',credential,'account_sha256',a.account_sha256);
end $$;

create function public.guard_puter_chapter(p_episode uuid,p_token uuid,p_submission boolean default false) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.studio_puter_accounts a join public.studio_puter_access x on x.account_id=a.id join public.episodes e on e.workspace_id=x.workspace_id
 where e.id=p_episode and a.lease_token=p_token and a.lease_until>now()
 and not exists(select 1 from public.studio_puter_runs r where r.episode_id=e.id and r.account_id<>a.id) for update of a;
 if not found then raise insufficient_privilege;end if;
 if p_submission and (not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) or
  not exists(select 1 from public.studio_puter_runs r join public.studio_puter_preparations p using(episode_id) join public.episodes e on e.id=r.episode_id
   where r.episode_id=p_episode and r.held and r.closed_at is null and e.status='research' and not p.cancel_requested)) then raise check_violation;end if;
 update public.studio_puter_accounts set lease_until=now()+interval '15 minutes' where lease_token=p_token;
end $$;

create function public.observe_puter_chapter(p_episode uuid,p_token uuid,p_observation jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.guard_puter_chapter(p_episode,p_token);
 if not public.valid_puter_observation(p_observation) or (p_observation->>'checked_at')::timestamptz not between now()-interval '2 minutes' and now()+interval '5 seconds' or
  not exists(select 1 from public.studio_puter_accounts where lease_token=p_token and account_sha256=p_observation->>'account_sha256') then raise check_violation;end if;
 update public.studio_puter_accounts set observation=p_observation,observed_at=(p_observation->>'checked_at')::timestamptz,last_code=null where lease_token=p_token;
end $$;

create function public.reserve_puter_chapter(p_episode uuid,p_token uuid,p_account uuid,p_run jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes;a public.studio_puter_accounts;p public.studio_puter_preparations;t jsonb;prior public.studio_puter_runs;profile jsonb;
begin
 perform public.guard_puter_chapter(p_episode,p_token);
 select * into strict a from public.studio_puter_accounts where id=p_account and lease_token=p_token for update;
 select * into strict e from public.episodes where id=p_episode for update;
 select * into strict p from public.studio_puter_preparations where episode_id=e.id;
 select * into prior from public.studio_puter_runs where episode_id=e.id;
 if found then
  if prior.account_id<>a.id or prior.state->>'fingerprint' is distinct from p_run->>'fingerprint' then raise check_violation;end if;
  return '{"code":"existing"}';
 end if;
 if e.status<>'research' or p.cancel_requested or not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) then raise check_violation;end if;
 if exists(select 1 from public.studio_puter_runs where account_id=a.id and held) then return '{"code":"account_busy"}';end if;
 if a.observed_at<now()-interval '2 minutes' or a.last_code is not null or a.observation->>'financially_eligible' is distinct from 'true' or
  coalesce((a.observation->>'remaining_credits')::numeric,0)<990 then return '{"code":"complete_chapter_budget_required"}';end if;
 profile:=public.studio_story_episode_profile(e.id)->'profile';
 if profile->>'version' is distinct from 'puter-native-1.0.0' or profile->>'native_voice_acknowledged' is distinct from 'true' or
  profile->>'model' is distinct from 'togetherai:wan-ai/wan2.7-i2v' or profile->>'contract_sha256' is distinct from 'af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364' or
  profile->>'output_fps' is distinct from '30' or profile->>'width' is distinct from '720' or profile->>'height' is distinct from '1280' or profile->>'voice_policy' is distinct from 'provider_generated_review' or
  profile is distinct from p_run->'profile' or public.story_episode_profile_hash(e.id) is distinct from p.profile_sha256 or
  e.briefing->'story_context' is distinct from p_run->'context' or p.draft is distinct from p_run->'draft' or p.fingerprint is distinct from p_run->>'fingerprint' or
  p_run->>'provider' is distinct from 'puter' or p_run->>'episode_id' is distinct from e.id::text or p_run->>'account_sha256' is distinct from a.account_sha256 or
  p_run->>'version' is distinct from '1' or p_run->>'reserved_credits' is distinct from '990' or p_run->>'revision' is distinct from '0' or
  p_run->'output' is distinct from 'null'::jsonb or p_run->>'budget_reconciled' is distinct from 'false' or
  coalesce((p_run->>'initial_remaining_credits')::numeric,0) not between 990 and (a.observation->>'remaining_credits')::numeric or
  (p_run->>'reserved_at')::timestamptz not between now()-interval '2 minutes' and now()+interval '5 seconds' or
  public.native_chapter_shots(p_run->'context')<>3 or jsonb_array_length(p_run->'tasks') is distinct from 3 or jsonb_array_length(p.draft->'scenes')<>3 then raise check_violation;end if;
 if not exists(select 1 from public.studio_chapter_presentations b join public.studio_story_presentations pr on pr.series_id=b.series_id and pr.revision=b.revision
  join public.studio_story_style_samples s on s.id=(profile#>>'{example,id}')::uuid and s.workspace_id=e.workspace_id
  where b.series_id=(e.briefing#>>'{story_context,series_id}')::uuid and b.chapter_number=(e.briefing#>>'{story_context,chapter_number}')::int and
   pr.preferences->>'source'='puter' and pr.preferences->>'voice_policy'='approved_variants' and s.ready and s.sample->>'source'='puter' and s.sample->>'style_id'=b.style_id and
   s.sample->>'sha256'=profile#>>'{example,sha256}' and s.sample->>'review_scope'='reviewed_sample' and s.sample->>'has_audio'='true') then raise check_violation;end if;
 if exists(select 1 from public.studio_native_runs where episode_id=e.id) or exists(select 1 from public.studio_animation_preparations where episode_id=e.id) then raise check_violation;end if;
 for t in select value from jsonb_array_elements(p_run->'tasks') loop
  if coalesce(t->>'request_key','')!~'^[a-f0-9]{64}$' or t->>'remote_filename' is distinct from 'content-ai-puter-'||(t->>'request_key')||'.mp4' or
   t->>'phase' is distinct from 'planned' or t->>'remote_complete' is distinct from 'false' or t->>'cleanup_done' is distinct from 'false' or
   t->'remote_sha256' is distinct from 'null'::jsonb or t->'clip' is distinct from 'null'::jsonb or t->'error_code' is distinct from 'null'::jsonb then raise check_violation;end if;
 end loop;
 if (select count(distinct x->>'request_key') from jsonb_array_elements(p_run->'tasks') x)<>3 then raise check_violation;end if;
 insert into public.studio_puter_runs(episode_id,workspace_id,account_id,state) values(e.id,e.workspace_id,a.id,p_run);
 return '{"code":"reserved"}';
end $$;


create function public.save_puter_chapter(p_episode uuid,p_token uuid,p_state jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_puter_runs;a jsonb;b jsonb;i int;base text;
begin
 perform public.guard_puter_chapter(p_episode,p_token);
 select * into strict r from public.studio_puter_runs where episode_id=p_episode for update;
 if r.state=p_state then return;end if;
 if r.closed_at is not null or (p_state->>'revision')::int is distinct from (r.state->>'revision')::int+1 or
  p_state-array['revision','tasks','output','budget_reconciled'] is distinct from r.state-array['revision','tasks','output','budget_reconciled'] or jsonb_array_length(p_state->'tasks') is distinct from 3 then raise check_violation;end if;
 for i in 0..2 loop
  a:=r.state->'tasks'->i;b:=p_state->'tasks'->i;
  if a-array['phase','remote_sha256','remote_complete','cleanup_done','clip','error_code'] is distinct from b-array['phase','remote_sha256','remote_complete','cleanup_done','clip','error_code'] or
   b->>'phase' is null or b->>'phase' not in ('planned','submission_started','submission_unknown','collecting','ready','failed') or
   (a->>'phase'='planned' and b->>'phase' not in ('planned','submission_started')) or
   (a->>'phase'<>'planned' and b->>'phase'='planned') or (a->>'phase'<>'planned' and b->>'phase'='submission_started') or
   (a->>'phase'='ready' and a-'cleanup_done' is distinct from b-'cleanup_done') or
   (a->>'phase'='failed' and a<>b) or
   (a->>'remote_complete'='true' and b->>'remote_complete' is distinct from 'true') or
   (a->>'cleanup_done'='true' and b->>'cleanup_done' is distinct from 'true') or
   (a->>'remote_sha256' is not null and a->'remote_sha256' is distinct from b->'remote_sha256') or
   jsonb_typeof(b->'remote_complete') is distinct from 'boolean' or jsonb_typeof(b->'cleanup_done') is distinct from 'boolean' or
   ((b->>'remote_complete'='true') is distinct from (b->>'remote_sha256' is not null)) or
   (b->>'remote_sha256' is not null and b->>'remote_sha256'!~'^[a-f0-9]{64}$') or
   (b->>'error_code' is not null and b->>'error_code'!~'^[a-z_]{1,80}$') then raise check_violation;end if;
  if b->>'phase'='planned' and b is distinct from a then raise check_violation;end if;
  if b->>'phase'='ready' then
   if b->>'remote_complete' is distinct from 'true' or b#>>'{clip,request_key}' is distinct from b->>'request_key' or b#>>'{clip,sha256}' is distinct from b->>'remote_sha256' or
    coalesce((b#>>'{clip,frames}')::int,0) not between 148 and 152 or b#>>'{clip,path}' is distinct from 'episodes/'||p_episode||'/native/'||(b->>'remote_sha256')||'.mp4' then raise check_violation;end if;
  elsif b->'clip' is distinct from 'null'::jsonb or b->>'cleanup_done'='true' then raise check_violation;end if;
  if i>0 and p_state->'tasks'->(i-1)->>'phase'<>'ready' and b->>'phase'<>'planned' then raise check_violation;end if;
 end loop;
 if (r.state->'output' is distinct from 'null'::jsonb and r.state->'output' is distinct from p_state->'output') or
  (r.state->>'budget_reconciled'='true' and p_state->>'budget_reconciled' is distinct from 'true') or jsonb_typeof(p_state->'budget_reconciled') is distinct from 'boolean' then raise check_violation;end if;
 if p_state->'output' is distinct from 'null'::jsonb or p_state->>'budget_reconciled'='true' then
  if exists(select 1 from jsonb_array_elements(p_state->'tasks') t where t->>'phase'<>'ready' or t->>'cleanup_done'<>'true') or p_state->'output' is not distinct from 'null'::jsonb then raise check_violation;end if;
  base:='episodes/'||p_episode||'/native/';a:=p_state->'output';
  if coalesce(a->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce(a->>'script_sha256','')!~'^[a-f0-9]{64}$' or coalesce(a->>'qa_sha256','')!~'^[a-f0-9]{64}$' or
   a->>'path' is distinct from base||(a->>'sha256')||'.mp4' or a->>'script_path' is distinct from base||(a->>'script_sha256')||'.json' or a->>'qa_path' is distinct from base||(a->>'qa_sha256')||'.json' or
   coalesce((a->>'bytes')::int,0) not between 1 and 52428800 then raise check_violation;end if;
 end if;
 update public.studio_puter_runs set state=p_state,held=p_state->>'budget_reconciled'<>'true',updated_at=now() where episode_id=p_episode;
 if r.state->'tasks' is distinct from p_state->'tasks' then update public.studio_puter_accounts set observed_at=null where id=r.account_id;end if;
end $$;

create function public.finish_puter_chapter(p_episode uuid,p_token uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 update public.studio_puter_accounts a set lease_token=null,lease_until=null from public.studio_puter_access x,public.episodes e
 where a.id=x.account_id and x.workspace_id=e.workspace_id and e.id=p_episode and a.lease_token=p_token
$$;

create function public.close_puter_chapter(p_episode uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_puter_runs;
begin
 perform public.guard_puter_chapter(p_episode,p_token);
 select * into strict r from public.studio_puter_runs where episode_id=p_episode for update;
 if not exists(select 1 from public.studio_puter_preparations where episode_id=p_episode and cancel_requested) then raise check_violation;end if;
 -- A missing private file does not prove that an uncertain POST was rejected.
 if exists(select 1 from jsonb_array_elements(r.state->'tasks') t where t->>'phase'<>'planned' and t->>'remote_complete'<>'true') then return '{"code":"cancellation_pending"}';end if;
 update public.studio_puter_runs set closed_at=now(),held=false where episode_id=p_episode;
 update public.episodes set status='failed',failure_reason='puter_chapter_cancelled_after_reconciliation' where id=p_episode and status='research';
 return '{"code":"cancelled"}';
end $$;


create or replace function public.complete_puter_chapter(p_episode uuid,p_token uuid,p_origin text,p_script_text text,p_qa_text text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_puter_runs;e public.episodes;s jsonb;q jsonb;t jsonb;scene jsonb;cut jsonb;ref jsonb;i int;frames int:=0;url text;
begin
 perform public.guard_puter_chapter(p_episode,p_token);
 select * into strict r from public.studio_puter_runs where episode_id=p_episode for update;
 select * into strict e from public.episodes where id=p_episode for update;
 if r.state->'output' is not distinct from 'null'::jsonb or exists(select 1 from jsonb_array_elements(r.state->'tasks') x where x->>'phase'<>'ready') then raise check_violation;end if;
 if p_origin is null or p_origin!~'^https://[a-z0-9-]+\.supabase\.co$' or p_script_text is null or p_qa_text is null or
  octet_length(p_script_text)>1048576 or octet_length(p_qa_text)>1048576 or
  encode(sha256(convert_to(p_script_text,'UTF8')),'hex') is distinct from r.state#>>'{output,script_sha256}' or
  encode(sha256(convert_to(p_qa_text,'UTF8')),'hex') is distinct from r.state#>>'{output,qa_sha256}' then raise check_violation;end if;
 s:=p_script_text::jsonb;q:=p_qa_text::jsonb;
 if q->'quality_policy' is distinct from (select value from public.system_config where key='fact_check') or r.state->>'budget_reconciled' is distinct from 'true' then raise check_violation;end if;
 if s->>'episode_id' is distinct from e.id::text or s#>'{fiction,context}' is distinct from e.briefing->'story_context' or
  s#>'{fiction,context}' is distinct from r.state->'context' or s#>'{fiction,summary}' is distinct from r.state#>'{draft,summary}' or
  s#>>'{fiction,native_animation,profile_sha256}' is distinct from public.story_episode_profile_hash(e.id) or
  s#>'{fiction,native_animation}' is distinct from jsonb_build_object('version','1.0.0','provider','puter','profile_sha256',public.story_episode_profile_hash(e.id),
    'width',720,'height',1280,'output_fps',30,'voice_identity_preserved',false,'speech_transcription_verified',false,'human_review_required',true) or
  s#>'{fiction,animation}' is not null or s->>'gap_seconds' is distinct from '0' or s->'music' is distinct from 'null'::jsonb or s?'platform_ctas' or
  s#>>'{disclosures,contains_synthetic_media}' is distinct from 'true' or s#>>'{disclosures,commercial_content}' is distinct from 'false' or
  s->'sources' is distinct from '[]'::jsonb or jsonb_array_length(s->'scenes') is distinct from jsonb_array_length(r.state->'tasks') or jsonb_array_length(q->'cuts') is distinct from jsonb_array_length(r.state->'tasks') or
  q->>'episode_id' is distinct from e.id::text or q->>'fingerprint' is distinct from r.state->>'fingerprint' or q->>'sha256' is distinct from r.state#>>'{output,sha256}' or
  q->>'width' is distinct from '720' or q->>'height' is distinct from '1280' or q->>'encoded_fps' is distinct from '30' or
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
   abs(coalesce((scene->>'duration_seconds')::numeric,0)-(t#>>'{clip,frames}')::numeric/30)>0.000000001 or scene->>'transition' is distinct from 'cut' or scene->>'ken_burns' is distinct from 'static' or
   scene->'asset_landscape' is distinct from 'null'::jsonb or scene#>>'{asset_portrait,url}' is distinct from p_origin||'/storage/v1/object/authenticated/studio-private/'||(t#>>'{clip,path}') or
   cut->>'speaker' is distinct from scene#>>'{story_visual,speaker_id}' or cut->>'source_sha256' is distinct from t#>>'{clip,sha256}' or cut->>'frames' is distinct from t#>>'{clip,frames}' or
   cut->>'original_audio' is distinct from 'true' or cut#>>'{audio_transport,silent_reference}' is distinct from 'false' or
   coalesce((cut#>>'{audio_transport,correlation}')::numeric,0)<0.90 or coalesce(abs((cut#>>'{audio_transport,measured_lag_seconds}')::numeric),1)>0.02 then raise check_violation;end if;
  frames:=frames+(t#>>'{clip,frames}')::int;
 end loop;
 if q->>'frames' is distinct from frames::text or abs(coalesce((q->>'seconds')::numeric,0)-frames::numeric/30)>0.000001 then raise check_violation;end if;
 url:=p_origin||'/storage/v1/object/authenticated/studio-private/'||(r.state#>>'{output,path}');
 if e.status in ('rendered','review') then
  if e.script_json is distinct from s or e.render_url is distinct from url then raise check_violation;end if;
  return '{"code":"saved"}';
 end if;
 if e.status<>'research' then raise check_violation;end if;
 update public.episodes set status='script',script_json=s,script_hash=q->>'script_hash',prompt_version=s->>'prompt_version',
  metadata=coalesce(metadata,'{}')||jsonb_build_object('puter_chapter',true,'script_qa',(q->'script_qa')||jsonb_build_object('script_hash',q->>'script_hash','policy_hash',q->>'policy_hash')) where id=e.id;
 update public.episodes set status='assets' where id=e.id;
 update public.episodes set status='rendered',render_url=url,metadata=metadata||jsonb_build_object('render_outputs',jsonb_build_object('portrait',url,'strategy','puter_native_chapter',
   'sha256',r.state#>>'{output,sha256}','seconds',(q->>'seconds')::numeric,'output_fps',30,'width',720,'height',1280,'qa_sha256',r.state#>>'{output,qa_sha256}')) where id=e.id;
 insert into public.job_events(episode_id,event_type,metadata) values(e.id,'qa_passed',jsonb_build_object('scope','native_chapter_assembly','script_hash',q->>'script_hash','policy_hash',q->>'policy_hash','human_review_required',true));
 return '{"code":"saved"}';
end $$;

create or replace function public.save_puter_media_review(p_episode uuid,p_report jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_puter_runs;e public.episodes;t jsonb;i int;
begin
 select * into strict r from public.studio_puter_runs where episode_id=p_episode;
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

create function public.studio_puter_step(p_episode uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.studio_puter_preparations;e public.episodes;r public.studio_puter_runs;
begin
 select * into strict e from public.episodes where id=p_episode for update;
 select * into strict p from public.studio_puter_preparations where episode_id=e.id for update;
 select * into r from public.studio_puter_runs where episode_id=e.id;
 if r.closed_at is not null or e.status<>'research' then return '{"code":"finished"}';end if;
 if not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) and r.episode_id is null then return '{"code":"native_setup_required"}';end if;
 if r.episode_id is not null and exists(select 1 from public.studio_puter_accounts where id=r.account_id and lease_until>now()) then return '{"code":"waiting_for_runner"}';end if;
 if p.dispatched_at>now()-interval '40 minutes' then return '{"code":"waiting_for_runner"}';end if;
 if p.attempts>=100 then return '{"code":"operator_required"}';end if;
 update public.studio_puter_preparations set dispatched_at=now(),attempts=attempts+1 where episode_id=e.id;
 return '{"code":"dispatch"}';
end $$;

create function public.puter_worker_result(p_episode uuid,p_code text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(p_code,'')!~'^[a-z_]{1,80}$' then raise check_violation;end if;
 update public.studio_puter_preparations set last_code=p_code where episode_id=p_episode;
end $$;

create function public.studio_puter_action(p_workspace uuid,p_actor uuid,p_episode uuid,p_action text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.studio_puter_preparations;r public.studio_puter_runs;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform 1 from public.episodes where id=p_episode and workspace_id=p_workspace and status='research' for update;
 if not found then return '{"code":"finished"}';end if;
 select * into strict p from public.studio_puter_preparations where episode_id=p_episode for update;
 select * into r from public.studio_puter_runs where episode_id=p_episode;
 if p_action not in ('resume','cancel') then raise check_violation;end if;
 if r.closed_at is not null then return '{"code":"finished"}';end if;
 if p_action='cancel' then
  update public.studio_puter_preparations set cancel_requested=true,last_code='cancellation_pending' where episode_id=p_episode;
  if r.episode_id is null then
   update public.episodes set status='failed',failure_reason='native_chapter_cancelled_before_submission' where id=p_episode;
   return '{"code":"cancelled"}';
  end if;
 end if;
 if r.episode_id is not null and exists(select 1 from public.studio_puter_accounts where id=r.account_id and lease_until>now()) then return '{"code":"waiting_for_runner"}';end if;
 if p.dispatched_at>now()-interval '2 minutes' then return '{"code":"waiting_for_runner"}';end if;
 update public.studio_puter_preparations set dispatched_at=null where episode_id=p_episode;
 return public.studio_puter_step(p_episode);
end $$;

alter function public.studio_story_manage(uuid,uuid,uuid,text) rename to studio_story_manage_before_puter;
revoke all on function public.studio_story_manage_before_puter(uuid,uuid,uuid,text) from service_role;
create function public.studio_story_manage(p_workspace uuid,p_actor uuid,p_series uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ep uuid;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform 1 from public.studio_series where id=p_series and workspace_id=p_workspace for update;if not found then raise insufficient_privilege;end if;
 select i.episode_id into ep from public.studio_story_chapters c join public.idea_queue i on i.id=c.idea_id where c.series_id=p_series order by c.chapter_number desc limit 1;
 if exists(select 1 from public.studio_puter_runs where episode_id=ep and held) then return '{"code":"existing_native_work"}';end if;
 if p_action='retry' and ep is not null and public.studio_story_episode_profile(ep)#>>'{profile,version}'='puter-native-1.0.0' then
  if not coalesce((select value->>'puter_chapter_enabled'='true' from public.system_config where key='story_production'),false) then return '{"code":"native_setup_required"}';end if;
  if public.native_chapter_shots((select briefing->'story_context' from public.episodes where id=ep))<>3 or
   not exists(select 1 from jsonb_array_elements(public.studio_puter_view(p_workspace,p_actor)->'accounts') a where a->>'balance_fresh'='true' and a->>'financially_eligible'='true' and (a->>'estimated_chapters')::int>=1) then return '{"code":"complete_chapter_budget_required"}';end if;
  return public.studio_story_manage_illustrated(p_workspace,p_actor,p_series,p_action);
 end if;
 return public.studio_story_manage_before_puter(p_workspace,p_actor,p_series,p_action);
end $$;


create function public.puter_recovery_episodes() returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(episode_id),'[]') from (select p.episode_id from public.studio_puter_preparations p join public.episodes e on e.id=p.episode_id
 left join public.studio_puter_runs r on r.episode_id=p.episode_id where e.status='research' and r.closed_at is null
 and coalesce(p.dispatched_at<now()-interval '40 minutes',true) order by p.created_at limit 3) q
$$;
alter function public.studio_puter_view(uuid,uuid) rename to studio_puter_view_before_chapters;
revoke all on function public.studio_puter_view_before_chapters(uuid,uuid) from service_role;
create function public.studio_puter_view(p_workspace uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;accounts jsonb;
begin
 result:=public.studio_puter_view_before_chapters(p_workspace,p_actor);
 select coalesce(jsonb_agg(a||jsonb_build_object('reserved',exists(select 1 from public.studio_puter_runs where account_id=(a->>'id')::uuid and held),
  'estimated_chapters',case when exists(select 1 from public.studio_puter_runs where account_id=(a->>'id')::uuid and held) then 0 else (a->>'estimated_chapters')::int end,
  'estimated_seconds',case when exists(select 1 from public.studio_puter_runs where account_id=(a->>'id')::uuid and held) then 0 else (a->>'estimated_seconds')::int end)),'[]') into accounts from jsonb_array_elements(result->'accounts') a;
 return jsonb_set(result,'{accounts}',accounts);
end $$;
alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_puter;
revoke all on function public.studio_video_overview_before_puter(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;progress jsonb;
begin
 result:=public.studio_video_overview_before_puter(p_workspace,p_actor);
 select coalesce(jsonb_agg(jsonb_build_object('episode_id',p.episode_id,'provider','puter','completed_shots',(select count(*) from jsonb_array_elements(coalesce(r.state->'tasks','[]')) t where t->>'phase'='ready'),
  'total_shots',public.native_chapter_shots(e.briefing->'story_context'),'planned_seconds',public.native_chapter_shots(e.briefing->'story_context')*5,'output_fps',30,
  'stage',case when r.closed_at is not null or p.cancel_requested and e.status='failed' then 'cancelled' when p.cancel_requested then 'cancellation_pending'
   when e.status in ('rendered','review','published','analyze') then e.status when r.episode_id is null then 'awaiting_capacity'
   when exists(select 1 from jsonb_array_elements(r.state->'tasks') t where t->>'phase' in ('failed','submission_unknown')) then 'reconciliation_required' else 'generating_clips' end,
  'last_code',p.last_code,'cancel_requested',p.cancel_requested,'closed',r.closed_at is not null or p.cancel_requested and e.status='failed')),'[]') into progress
  from public.studio_puter_preparations p join public.episodes e on e.id=p.episode_id left join public.studio_puter_runs r on r.episode_id=p.episode_id where p.workspace_id=p_workspace;
 return result||jsonb_build_object('puter',public.studio_puter_view(p_workspace,p_actor),'native_chapters',(result->'native_chapters')||progress);
end $$;

revoke all on function public.valid_story_presentation(jsonb) from public,anon,authenticated;
grant execute on function public.valid_story_presentation(jsonb) to service_role;

revoke all on function public.story_pattern_editable(uuid) from public,anon,authenticated;
grant execute on function public.story_pattern_editable(uuid) to service_role;

revoke all on function public.studio_story_pattern_view(uuid,uuid,uuid,int,text) from public,anon,authenticated;
grant execute on function public.studio_story_pattern_view(uuid,uuid,uuid,int,text) to service_role;

revoke all on function public.studio_puter_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.studio_puter_pattern_finalize(uuid,uuid,uuid,int,text,jsonb,text) to service_role;

revoke all on function public.studio_story_next_presented(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_next_presented(uuid,uuid,uuid,text) to service_role;

revoke all on function public.save_puter_draft(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_puter_draft(uuid,text,text,jsonb) to service_role;

revoke all on function public.puter_worker_input(uuid) from public,anon,authenticated;
grant execute on function public.puter_worker_input(uuid) to service_role;

revoke all on function public.claim_puter_chapter(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_puter_chapter(uuid,uuid,uuid) to service_role;

revoke all on function public.guard_puter_chapter(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.guard_puter_chapter(uuid,uuid,boolean) to service_role;

revoke all on function public.observe_puter_chapter(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.observe_puter_chapter(uuid,uuid,jsonb) to service_role;

revoke all on function public.reserve_puter_chapter(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_puter_chapter(uuid,uuid,uuid,jsonb) to service_role;

revoke all on function public.save_puter_chapter(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_puter_chapter(uuid,uuid,jsonb) to service_role;

revoke all on function public.finish_puter_chapter(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_puter_chapter(uuid,uuid) to service_role;

revoke all on function public.close_puter_chapter(uuid,uuid) from public,anon,authenticated;
grant execute on function public.close_puter_chapter(uuid,uuid) to service_role;

revoke all on function public.complete_puter_chapter(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_puter_chapter(uuid,uuid,text,text,text) to service_role;

revoke all on function public.save_puter_media_review(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_puter_media_review(uuid,jsonb) to service_role;

revoke all on function public.studio_puter_step(uuid) from public,anon,authenticated;
grant execute on function public.studio_puter_step(uuid) to service_role;

revoke all on function public.puter_worker_result(uuid,text) from public,anon,authenticated;
grant execute on function public.puter_worker_result(uuid,text) to service_role;

revoke all on function public.studio_puter_action(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_puter_action(uuid,uuid,uuid,text) to service_role;

revoke all on function public.studio_story_manage(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.studio_story_manage(uuid,uuid,uuid,text) to service_role;

revoke all on function public.puter_recovery_episodes() from public,anon,authenticated;
grant execute on function public.puter_recovery_episodes() to service_role;

revoke all on function public.studio_puter_view(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_puter_view(uuid,uuid) to service_role;

revoke all on function public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_overview(uuid,uuid) to service_role;
