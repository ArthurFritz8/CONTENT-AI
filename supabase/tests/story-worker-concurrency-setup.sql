\set ON_ERROR_STOP on
-- Run after the video reservation concurrency test, inside the disposable audit DB only.
create table public.worker_concurrency_fixture(job uuid primary key,capability text);
create table public.worker_concurrency_results(slot int primary key,code text);
do $$
declare j uuid; reply jsonb; cap text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 select id into strict j from public.studio_video_jobs where wallet_id in
  (select id from public.studio_video_wallets where quota_group like 'concurrency-%') and state='queued' order by id limit 1;
 reply:=public.claim_video_job(j);
 if reply->>'code'<>'claimed' then raise exception 'Concurrency fixture was not claimed'; end if;
 perform public.register_video_worker(j,(reply->>'token')::uuid,cap);
 insert into public.worker_concurrency_fixture values(j,cap);
end $$;
