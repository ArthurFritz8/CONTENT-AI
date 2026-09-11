-- Disposable database only; this test intentionally commits shared state.
\set ON_ERROR_STOP on
update public.system_config set value=jsonb_set(value,'{max_episodes_per_day}','2') where key='pipeline';
update public.system_config set value=jsonb_set(value,'{gemini_models,gemini-2.5-flash,rpm}','5') where key='budget';
insert into public.idea_queue(briefing,niche) select 'Concurrency fixture '||n,'gadgets' from generate_series(1,12) n;
