\set ON_ERROR_STOP on
do $$
begin
 if (select count(*) from public.worker_concurrency_results where code='started')<>1 or
    (select count(*) from public.worker_concurrency_results where code='already_started')<>11 then
  raise exception 'Concurrent CPU relays could start inference more than once'; end if;
 if not exists(select 1 from public.studio_video_jobs where id=(select job from public.worker_concurrency_fixture)
  and state='accepted' and external_id='fc-worker-concurrency' and not balance_reconciled) then
  raise exception 'External identity or budget was lost'; end if;
end $$;
drop table public.worker_concurrency_results;
drop table public.worker_concurrency_fixture;
