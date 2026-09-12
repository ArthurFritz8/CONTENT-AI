\set ON_ERROR_STOP on
-- Read-only structural checks; fails deployment instead of reporting a false success.
do $$
declare tbl text;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='publishes' and column_name='session_url')
    or has_function_privilege('anon','public.claim_youtube_upload(uuid,uuid)','execute') then
    raise exception 'Private upload ledger missing or unsafe (ADR-019)';
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
  if not exists(select 1 from pg_trigger where tgname='episodes_z_gate' and not tgisinternal) then raise exception 'Approval gate missing'; end if;
  if has_function_privilege('anon','public.consume_next_idea()','execute') then raise exception 'Unsafe RPC permissions'; end if;
  if not exists(select 1 from storage.buckets where id='assets' and public) then raise exception 'Public assets bucket missing'; end if;
  if not exists(select 1 from public.system_config where key='budget' and value ? 'gemini_models') then raise exception 'Model quotas must be configured'; end if;
end $$;
