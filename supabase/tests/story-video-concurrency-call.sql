\set ON_ERROR_STOP on
select public.studio_reserve_video(workspace,actor,request,episode,repeat('a',64),plan) from public.video_concurrency_fixture where slot=:slot;
