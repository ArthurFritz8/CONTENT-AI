\set ON_ERROR_STOP on
select scenario,public.studio_video_queue_reserve(workspace,actor,queue,request,0,0,plan)
 from public.video_queue_concurrency_fixture where slot=:slot order by scenario;