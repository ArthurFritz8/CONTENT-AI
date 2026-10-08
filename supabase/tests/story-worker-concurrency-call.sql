\set ON_ERROR_STOP on
insert into public.worker_concurrency_results(slot,code)
select :slot,public.begin_video_worker(job,capability,'fc-worker-concurrency')->>'code' from public.worker_concurrency_fixture;
