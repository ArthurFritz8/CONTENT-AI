\set ON_ERROR_STOP on
select pg_sleep(1);
select public.reserve_gemini_call('text','gemini-3.6-flash');
select * from public.consume_next_idea();
