-- Native dialogue is a separate contract. This migration does NOT enable it,
-- change any Modal profile, or turn the read-only Auray monitor into a generator.
create table public.studio_native_runs (
 episode_id uuid primary key references public.episodes(id),
 workspace_id uuid not null references public.studio_workspaces(id),
 wallet_id uuid not null references public.studio_auray_config(wallet_id),
 state jsonb not null, held boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(state->>'episode_id'=episode_id::text),
 check(state->>'version'='1'),check(state->>'reserved_credits'='15'),
 check(jsonb_typeof(state->'tasks')='array' and jsonb_array_length(state->'tasks')=3),
 check(held = (state->>'budget_reconciled'='false'))
);
create unique index studio_native_account_hold on public.studio_native_runs(wallet_id) where held;
alter table public.studio_native_runs enable row level security;
revoke all on public.studio_native_runs from public,anon,authenticated;
grant all on public.studio_native_runs to service_role;

create function public.reserve_native_chapter(p_episode uuid,p_wallet uuid,p_run jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.episodes; c public.studio_auray_config; profile jsonb; pref jsonb; prior public.studio_native_runs; task jsonb; stamp timestamptz;
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
 stamp:=(p_run->>'reserved_at')::timestamptz;
 if stamp is null or stamp not between now()-interval '2 minutes' and now()+interval '5 seconds' or
  p_run->>'period' is distinct from to_char(now() at time zone 'UTC','YYYY-MM') or
  p_run->>'episode_id' is distinct from p_episode::text or p_run->>'version' is distinct from '1' or
  p_run->>'reserved_credits' is distinct from '15' or p_run->>'revision' is distinct from '0' or p_run->'output' is distinct from 'null'::jsonb or
  p_run->>'budget_reconciled' is distinct from 'false' or coalesce((p_run->>'initial_plan_remaining')::int,0)<15 or
  coalesce((p_run->>'initial_key_remaining')::int,0)<15 or coalesce(p_run->>'fingerprint','')!~'^[a-f0-9]{64}$' or
  c.account_sha256 is distinct from encode(sha256(convert_to('{"account":'||to_jsonb(p_run->>'account_id')::text||',"provider":"auray"}','UTF8')),'hex') or
  jsonb_typeof(p_run->'tasks') is distinct from 'array' or jsonb_array_length(p_run->'tasks')<>3 then raise check_violation;end if;
 for task in select value from jsonb_array_elements(p_run->'tasks') loop
  if task->>'phase' is distinct from 'planned' or task->>'charged_credits' is distinct from '0' or task->>'settled' is distinct from 'false' or task->'clip' is distinct from 'null'::jsonb or
   coalesce(task->>'request_key','')!~'^[a-f0-9]{64}$' or task->>'job_id' is distinct from 'video_'||(task->>'request_key') then raise check_violation;end if;
 end loop;
 if (select count(distinct value->>'request_key') from jsonb_array_elements(p_run->'tasks'))<>3 then raise check_violation;end if;
 insert into public.studio_native_runs(episode_id,workspace_id,wallet_id,state) values(p_episode,e.workspace_id,p_wallet,p_run);
 return '{"code":"reserved"}';
end $$;

create function public.claim_native_chapter(p_episode uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.studio_native_runs; c public.studio_auray_config;
begin
 select * into strict r from public.studio_native_runs where episode_id=p_episode;
 select * into strict c from public.studio_auray_config where wallet_id=r.wallet_id for update;
 if c.lease_until>now() then return '{"code":"waiting"}';end if;
 update public.studio_auray_config set lease_token=p_token,lease_until=now()+interval '5 minutes' where wallet_id=r.wallet_id;
 return jsonb_build_object('code','claimed','state',r.state);
end $$;

create function public.guard_native_chapter(p_episode uuid,p_token uuid,p_submission boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.studio_auray_config c join public.studio_native_runs r on r.wallet_id=c.wallet_id
 where r.episode_id=p_episode and c.lease_token=p_token and c.lease_until>now() for update of c;
 if not found then raise insufficient_privilege;end if;
 if p_submission and (not coalesce((select value->>'native_chapter_enabled'='true' from public.system_config where key='story_production'),false) or
  not exists(select 1 from public.studio_native_runs r join public.episodes e on e.id=r.episode_id where r.episode_id=p_episode and r.held and e.status='research')) then raise check_violation;end if;
 update public.studio_auray_config c set lease_until=now()+interval '5 minutes'
 from public.studio_native_runs r where r.episode_id=p_episode and r.wallet_id=c.wallet_id and c.lease_token=p_token;
end $$;

create function public.save_native_chapter(p_episode uuid,p_token uuid,p_state jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.studio_native_runs; a jsonb; b jsonb; i int; base text;
begin
 perform public.guard_native_chapter(p_episode,p_token);
 select * into strict prior from public.studio_native_runs where episode_id=p_episode for update;
 -- Idempotent acknowledgement when the previous database response was lost.
 if prior.state=p_state then return;end if;
 if (p_state->>'revision')::int is distinct from (prior.state->>'revision')::int+1 or
  (p_state-array['revision','tasks','output','budget_reconciled']) is distinct from (prior.state-array['revision','tasks','output','budget_reconciled']) or
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

create function public.complete_native_chapter(p_episode uuid,p_token uuid,p_origin text,p_script_text text,p_qa_text text) returns jsonb
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
  s->'sources' is distinct from '[]'::jsonb or jsonb_array_length(s->'scenes') is distinct from 3 or jsonb_array_length(q->'cuts') is distinct from 3 or
  q->>'episode_id' is distinct from e.id::text or q->>'fingerprint' is distinct from r.state->>'fingerprint' or q->>'sha256' is distinct from r.state#>>'{output,sha256}' or
  q->>'width' is distinct from '768' or q->>'height' is distinct from '1344' or q->>'encoded_fps' is distinct from '24' or
  q->>'all_decoded_frames_pixel_identical' is distinct from 'true' or q->>'video_reencoded' is distinct from 'false' or
  q->>'audio_encoded_once_from_native_pcm' is distinct from 'true' or q->>'decode_verified' is distinct from 'true' or
  q->>'human_review_required' is distinct from 'true' or q->>'voice_continuity_approved' is distinct from 'false' or q->>'production_ready' is distinct from 'false' or
  q#>>'{script_qa,passed}' is distinct from 'true' or coalesce(q->>'script_hash','')!~'^[a-f0-9]{64}$' or coalesce(q->>'policy_hash','')!~'^[a-f0-9]{64}$' then raise check_violation;end if;
 for i in 0..2 loop
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

create function public.finish_native_chapter(p_episode uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Release the account lease, never the chapter's financial reservation.
 update public.studio_auray_config c set lease_token=null,lease_until=null from public.studio_native_runs r
 where r.episode_id=p_episode and c.wallet_id=r.wallet_id and c.lease_token=p_token;
 if not found then raise insufficient_privilege;end if;
end $$;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_native;
revoke all on function public.studio_video_overview_before_native(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;wallets jsonb;
begin
 result:=public.studio_video_overview_before_native(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||case when c.wallet_id is null then '{}'::jsonb else jsonb_build_object(
  'native_reserved_credits',coalesce(h.units,0),'reserved_units',coalesce((v->>'reserved_units')::bigint,0)+coalesce(h.units,0),
  'budget_only_shots',case when v->>'budget_only_shots' is not null then greatest(0,(v->>'budget_only_shots')::int-coalesce(h.units,0)/5) else null end
 ) end order by v->>'label'),'[]') into wallets from jsonb_array_elements(result->'wallets') v
 left join public.studio_auray_config c on c.wallet_id=(v->>'id')::uuid
 left join lateral(select sum(15)::int units from public.studio_native_runs r where r.wallet_id=c.wallet_id and held) h on true;
 return jsonb_set(result,'{wallets}',wallets);
end $$;

revoke all on function public.reserve_native_chapter(uuid,uuid,jsonb),public.claim_native_chapter(uuid,uuid),public.guard_native_chapter(uuid,uuid,boolean),public.save_native_chapter(uuid,uuid,jsonb),public.complete_native_chapter(uuid,uuid,text,text,text),public.finish_native_chapter(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_native_chapter(uuid,uuid,jsonb),public.claim_native_chapter(uuid,uuid),public.guard_native_chapter(uuid,uuid,boolean),public.save_native_chapter(uuid,uuid,jsonb),public.complete_native_chapter(uuid,uuid,text,text,text),public.finish_native_chapter(uuid,uuid) to service_role;
revoke all on function public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_overview(uuid,uuid) to service_role;
