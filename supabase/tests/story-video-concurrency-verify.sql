\set ON_ERROR_STOP on
do $$
begin
 if (select count(*) from public.studio_video_jobs where wallet_id in(select wallet from public.video_concurrency_fixture))<>3 then
  raise exception 'Concurrent reservations did not preserve the wallet budget'; end if;
 if (select sum(reserved_units) from public.studio_video_jobs where wallet_id in(select wallet from public.video_concurrency_fixture))<>30 then
  raise exception 'Concurrent reservation overspent or lost funds'; end if;
 if (select count(*) from public.studio_video_requests where id in(select request from public.video_concurrency_fixture))<>3 then
  raise exception 'Rejected chapters retained partial reservations'; end if;
end $$;
drop table public.video_concurrency_fixture;
