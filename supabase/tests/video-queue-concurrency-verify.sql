\set ON_ERROR_STOP on
do $$
declare scenario_name text;wallet uuid;workspace_id uuid;
begin
 foreach scenario_name in array array['shared','cursor'] loop
  select f.wallet into wallet from public.video_queue_concurrency_fixture f where scenario=scenario_name limit 1;
  if (select count(*) from public.studio_video_jobs j where j.wallet_id=wallet)<>5 or
   (select sum(reserved_units) from public.studio_video_jobs j where j.wallet_id=wallet)<>50 then
   raise exception 'Video queue race must reserve one complete chapter: %',scenario_name;
  end if;
  if (select count(*) from public.studio_video_queue q join public.video_queue_concurrency_fixture f on f.queue=q.id
   where f.scenario=scenario_name and q.state='reserved' and q.revision=1)<>1 then
   raise exception 'Concurrent queue entries double-reserved: %',scenario_name;
  end if;
  if (select sum(c.revision) from public.studio_video_queue_cursors c
   where c.workspace_id in(select f.workspace from public.video_queue_concurrency_fixture f where f.scenario=scenario_name))<>1 then
   raise exception 'Cursor advanced without reservation: %',scenario_name;
  end if;
  if (select count(*) from public.studio_video_requests r join public.video_queue_concurrency_fixture f on f.request=r.id
   where f.scenario=scenario_name)<>1 then raise exception 'Failed race retained partial request';end if;
 end loop;
 update public.system_config set value='{"reservation_enabled":false}' where key='video_queue';
end $$;
drop table public.video_queue_concurrency_fixture;