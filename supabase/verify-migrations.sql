\set ON_ERROR_STOP on
-- Read-only structural checks; fails deployment instead of reporting a false success.
do $$
declare tab text;fn text;
begin
 foreach tab in array array['studio_video_queue','studio_video_queue_cursors','studio_puter_queue'] loop
  if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity) or
   has_table_privilege('anon','public.'||tab,'select') or has_table_privilege('authenticated','public.'||tab,'select') then
   raise exception 'Persistent video queue must remain private: %',tab;
  end if;
 end loop;
 foreach fn in array array['studio_video_enqueue(uuid,uuid,uuid,uuid,text,int)','studio_video_queue_cancel(uuid,uuid,uuid,bigint)',
  'studio_video_queue_reserve(uuid,uuid,uuid,uuid,bigint,bigint,jsonb)','studio_video_queue_view(uuid,uuid)','studio_video_queue_snapshot(uuid,uuid)','studio_puter_queue_snapshot(uuid,uuid)',
  'studio_puter_pilot_prepare(uuid,uuid,uuid,uuid,int,text,text,text,jsonb)','studio_puter_pilot_revise(uuid,uuid,uuid,bigint,text,text,jsonb)'] loop
  if has_function_privilege('anon','public.'||fn,'execute') or has_function_privilege('authenticated','public.'||fn,'execute') or
   not has_function_privilege('service_role','public.'||fn,'execute') then raise exception 'Video queue RPC exposed: %',fn;end if;
 end loop;
 foreach fn in array array['puter_worker_input_before_planning(uuid)','claim_puter_chapter_before_planning(uuid,uuid,uuid)',
  'guard_puter_chapter_before_planning(uuid,uuid,boolean)','studio_puter_queue_snapshot_before_planning(uuid,uuid)'] loop
  if has_function_privilege('service_role','public.'||fn,'execute') or has_function_privilege('anon','public.'||fn,'execute') or
   has_function_privilege('authenticated','public.'||fn,'execute') then raise exception 'Planning-only pilot bypass exposed: %',fn;end if;
 end loop;
 if has_function_privilege('service_role','public.studio_video_enqueue_before_puter(uuid,uuid,uuid,uuid,text,int)','execute') or
  has_function_privilege('service_role','public.studio_video_queue_cancel_before_puter(uuid,uuid,uuid,bigint)','execute') then
  raise exception 'Legacy native queue bypass exposed';
 end if;
 if not exists(select 1 from public.system_config where key='video_queue' and jsonb_typeof(value->'reservation_enabled')='boolean') then
  raise exception 'Video queue requires an explicit reservation gate';
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_class where oid='public.studio_native_media_reviews'::regclass and relrowsecurity) or
  has_table_privilege('authenticated','public.studio_native_media_reviews','select') or
  has_function_privilege('authenticated','public.save_native_media_review(uuid,jsonb)','execute') or
  has_function_privilege('anon','public.studio_native_media_review(uuid,uuid,uuid)','execute') then
  raise exception 'Native media review must remain private and server-written';
 end if;
end $$;
do $$
declare tbl text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='telegram_commands' and column_name='reply_status')
    or has_function_privilege('anon','public.telegram_queue_command(bigint,text,text,text,text,uuid,text)','execute') then
    raise exception 'Telegram queue command ledger missing or unsafe (ADR-020)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='publishes' and column_name='session_url')
    or has_function_privilege('anon','public.claim_youtube_upload(uuid,uuid)','execute') then
    raise exception 'Private upload ledger missing or unsafe (ADR-019)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='idea_queue' and column_name='affiliate_links')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='publishes' and column_name='affiliate_url')
    or not exists(select 1 from public.system_config where key='affiliate_monetization')
    or has_function_privilege('anon','public.affiliate_link_for_platform(jsonb,text)','execute') then
    raise exception 'Platform affiliate links missing or unsafe (ADR-036)';
  end if;
  if not exists(select 1 from pg_trigger where tgname='episodes_zz_review_gate' and not tgisinternal) then
    raise exception 'Version-bound review gate missing (ADR-018)';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='episodes' and column_name='research_evidence') then
    raise exception 'Research evidence migration missing (ADR-017)';
  end if;
  foreach tbl in array array['episodes','assets','publishes','job_events','prompt_versions','system_config','idea_queue','api_budget_usage','episode_leases','review_requests','telegram_updates','telegram_commands'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=tbl and c.relrowsecurity) then
      raise exception 'Missing table or RLS: %',tbl;
    end if;
  end loop;
  foreach tbl in array array['studio_video_wallets','studio_video_wallet_access','studio_series_production','studio_video_compatibility','studio_video_requests','studio_video_jobs','studio_video_worker_tickets',
   'studio_animated_renders','studio_modal_wallet_config','studio_modal_observations','studio_animation_preparations','studio_animation_audio','studio_animation_dispatches','studio_production_media','studio_production_setup'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=tbl and c.relrowsecurity) then
      raise exception 'Video production table missing RLS: %',tbl;
    end if;
  end loop;
  if has_function_privilege('authenticated','public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb)','execute')
    or has_function_privilege('anon','public.claim_video_job(uuid)','execute')
    or has_function_privilege('authenticated','public.begin_video_worker(uuid,text,text)','execute')
    or has_function_privilege('anon','public.complete_video_worker(uuid,text,jsonb,jsonb,boolean)','execute') then
    raise exception 'Video production worker RPC is exposed';
  end if;
  if has_function_privilege('anon','public.claim_profile_voices(uuid,uuid)','execute') or
    has_function_privilege('authenticated','public.studio_production_finalize(uuid,uuid,uuid,jsonb,text)','execute') or
    has_function_privilege('service_role','public.studio_story_next_before_setup(uuid,uuid,uuid)','execute') or
    has_function_privilege('authenticated','public.observe_modal_wallet(uuid,jsonb)','execute') or
    has_function_privilege('anon','public.save_animation_draft(uuid,text,text,jsonb)','execute') or
    has_function_privilege('authenticated','public.claim_animation_preparation(uuid,uuid)','execute') or
    has_function_privilege('anon','public.studio_animation_step(uuid)','execute') or
    has_function_privilege('service_role','public.studio_reserve_video_before_billing(uuid,uuid,uuid,uuid,text,jsonb)','execute') then
    raise exception 'Animated preparation or financial bypass RPC exposed';
  end if;
  if not exists(select 1 from pg_trigger where tgname='episodes_z_gate' and not tgisinternal) then raise exception 'Approval gate missing'; end if;
  if has_function_privilege('anon','public.consume_next_idea()','execute') then raise exception 'Unsafe RPC permissions'; end if;
  if not exists(select 1 from storage.buckets where id='assets' and public) then raise exception 'Public assets bucket missing'; end if;
  if has_function_privilege('anon','public.configure_content_ai_scheduler(text,text)','execute')
    or has_function_privilege('authenticated','public.configure_content_ai_scheduler(text,text)','execute') then
    raise exception 'Cloud scheduler setup RPC is exposed';
  end if;
  if not exists(select 1 from public.system_config where key='budget' and value ? 'gemini_models') then raise exception 'Model quotas must be configured'; end if;
  if not exists(select 1 from public.system_config where key='growth_strategy')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='idea_queue' and column_name='validated_at') then
    raise exception 'Growth policy and candidate validation required (ADR-037)';
  end if;
end $$;

do $$
declare tbl text;
begin
 foreach tbl in array array['studio_story_presentations','studio_chapter_presentations','studio_story_style_samples','studio_story_patterns','studio_chapter_productions','studio_native_runs','studio_native_preparations'] loop
  if not exists(select 1 from pg_class where oid=('public.'||tbl)::regclass and relrowsecurity) or
     has_table_privilege('authenticated','public.'||tbl,'SELECT') or has_table_privilege('anon','public.'||tbl,'SELECT') then
   raise exception 'Style catalogue table missing privacy: %',tbl;
  end if;
 end loop;
 if has_function_privilege('service_role','public.studio_story_next_before_presentation(uuid,uuid,uuid)','execute') or
    has_function_privilege('service_role','public.studio_story_save_before_presentation(uuid,uuid,uuid,jsonb)','execute') or
    has_function_privilege('authenticated','public.register_story_style_sample(uuid,jsonb)','execute') or
    has_function_privilege('anon','public.studio_story_presentation_save(uuid,uuid,uuid,integer,uuid,jsonb,boolean)','execute') or
    has_function_privilege('authenticated','public.studio_story_style_media(uuid,uuid,uuid)','execute') or
    has_function_privilege('anon','public.studio_story_episode_profile(uuid)','execute') or
    has_function_privilege('authenticated','public.studio_story_pattern_finalize(uuid,uuid,uuid,integer,text,jsonb,text)','execute') or
    has_function_privilege('authenticated','public.reserve_native_chapter(uuid,uuid,jsonb)','execute') or
    has_function_privilege('anon','public.save_native_chapter(uuid,uuid,jsonb)','execute') or
    has_function_privilege('authenticated','public.complete_native_chapter(uuid,uuid,text,text,text)','execute') or
    has_function_privilege('service_role','public.complete_native_chapter_before_policy(uuid,uuid,text,text,text)','execute') or
    has_function_privilege('authenticated','public.native_worker_input(uuid)','execute') or
    has_function_privilege('authenticated','public.close_native_chapter(uuid,uuid,jsonb)','execute') or
    has_function_privilege('service_role','public.studio_video_overview_before_native_panel(uuid,uuid)','execute') or
    has_function_privilege('service_role','public.studio_story_pattern_view_before_native(uuid,uuid,uuid,integer,text)','execute') or
    has_function_privilege('service_role','public.studio_video_overview_before_native(uuid,uuid)','execute') or
    has_function_privilege('service_role','public.save_animation_draft_before_patterns(uuid,text,text,jsonb)','execute') or
    has_function_privilege('service_role','public.studio_reserve_video_before_patterns(uuid,uuid,uuid,uuid,text,jsonb)','execute') then
  raise exception 'Style history or gallery RPC exposed (ADR-078)';
 end if;
 if (select count(*) from pg_trigger where tgrelid in ('public.studio_story_presentations'::regclass,'public.studio_chapter_presentations'::regclass) and not tgisinternal and (tgtype & 2)=2) < 2 then
  raise exception 'Immutable style history guards missing (ADR-078)';
 end if;
end $$;

do $$
begin
 if has_function_privilege('anon','public.claim_auray_sync(uuid,uuid)','execute') or
  has_function_privilege('authenticated','public.finish_auray_sync(uuid,uuid,boolean,text)','execute') or
  has_function_privilege('service_role','public.studio_video_overview_before_sync_diagnostics(uuid,uuid)','execute') or
    has_function_privilege('authenticated','public.observe_auray_monitor(uuid,uuid,jsonb)','execute') or
    has_function_privilege('authenticated','public.register_auray_monitor(uuid,text,jsonb)','execute') or
    has_function_privilege('service_role','public.studio_video_overview_before_auray(uuid,uuid)','execute') then
  raise exception 'Auray monitor RPC exposed';
 end if;
 if not exists(select 1 from pg_class where oid='public.studio_auray_jobs'::regclass and relrowsecurity) or
    not exists(select 1 from pg_trigger where tgname='auray_candidate_wallet' and not tgisinternal) then
  raise exception 'Auray monitoring must preserve workspace privacy and production lock';
 end if;
end $$;

-- ADR-083: editorial and credential-bearing operations are server-only.
do $$
declare fn text;tab text;
begin
 foreach fn in array array['studio_story_editorial_view(uuid,uuid,uuid)','studio_story_editorial_save(uuid,uuid,uuid,uuid,jsonb)','studio_story_revision_claim(uuid,uuid,uuid,uuid,jsonb)','studio_story_season_add(uuid,uuid,uuid,uuid,integer,jsonb)','studio_native_repair_view(uuid,uuid,uuid)','studio_native_repair_prepare(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','studio_native_repair_restore(uuid,uuid,uuid)','studio_reference_view(uuid,uuid,uuid)','studio_reference_request(uuid,uuid,uuid,uuid,integer,text,text)','claim_reference_job(uuid,uuid)','finish_reference_job(uuid,uuid,text,uuid)','reference_recovery_jobs()'] loop
  if has_function_privilege('anon','public.'||fn,'execute') or has_function_privilege('authenticated','public.'||fn,'execute') or not has_function_privilege('service_role','public.'||fn,'execute') then raise exception 'Editorial/reference RPC exposed: %',fn;end if;
 end loop;
 if has_function_privilege('service_role','public.native_worker_input_before_repair(uuid)','execute') then raise exception 'Legacy worker admission exposed';end if;
 foreach tab in array array['studio_story_editorial_history','studio_story_revisions','studio_story_seasons','studio_native_repairs','studio_reference_jobs'] loop
  if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity) or has_table_privilege('authenticated','public.'||tab,'select') then raise exception 'Editorial/reference data exposed: %',tab;end if;
 end loop;
end $$;


-- ADR-084: duration is separate from immutable visual profiles and frozen chapters.
do $$begin
 if has_function_privilege('authenticated','public.studio_story_duration_save(uuid,uuid,uuid,uuid,int,int)','execute') or
    has_function_privilege('anon','public.native_chapter_shots(jsonb)','execute') or
    has_function_privilege('service_role','public.studio_story_overview_before_duration(uuid,uuid)','execute') or
    has_table_privilege('authenticated','public.studio_story_format_history','select') or
    not exists(select 1 from pg_class where oid='public.studio_story_format_history'::regclass and relrowsecurity) or
    not exists(select 1 from pg_trigger where tgname='story_format_history_immutable' and not tgisinternal) then raise exception 'Native duration history or RPC exposed';end if;
 if public.native_chapter_shots('{}')<>3 or public.native_chapter_shots('{"native_format":{"shots":9}}')<>9 then raise exception 'Native format contract missing';end if;
end $$;

-- Puter account credentials and native checkpoints stay service-only.
do $$declare tab text;fn text;begin
 foreach tab in array array['studio_puter_accounts','studio_puter_access','studio_puter_preparations','studio_puter_runs'] loop
  if not exists(select 1 from pg_class where oid=('public.'||tab)::regclass and relrowsecurity) or has_table_privilege('authenticated','public.'||tab,'select') then raise exception 'Puter data exposed: %',tab;end if;
 end loop;
 foreach fn in array array['studio_puter_connect(uuid,uuid,text,jsonb)','claim_puter_inspection(uuid,uuid,uuid,uuid)','claim_puter_chapter(uuid,uuid,uuid)','reserve_puter_chapter(uuid,uuid,uuid,jsonb)','save_puter_chapter(uuid,uuid,jsonb)','complete_puter_chapter(uuid,uuid,text,text,text)','studio_puter_action(uuid,uuid,uuid,text)','studio_puter_pattern_finalize(uuid,uuid,uuid,integer,text,jsonb,text)'] loop
  if has_function_privilege('anon','public.'||fn,'execute') or has_function_privilege('authenticated','public.'||fn,'execute') or not has_function_privilege('service_role','public.'||fn,'execute') then raise exception 'Puter RPC exposed: %',fn;end if;
 end loop;
 if has_function_privilege('service_role','public.studio_puter_view_before_chapters(uuid,uuid)','execute') or has_function_privilege('service_role','public.studio_video_overview_before_puter(uuid,uuid)','execute') then raise exception 'Puter legacy bypass exposed';end if;
end $$;
