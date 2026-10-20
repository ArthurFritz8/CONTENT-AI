\set ON_ERROR_STOP on
begin;
\ir video-queue-fixture.sql
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();workspace uuid;foreign_workspace uuid;wallet uuid:=gen_random_uuid();
 fixture jsonb;foreign_fixture jsonb;snapshot jsonb;entry uuid;
begin
 workspace:=public.studio_provision(actor,'Queue panel audit',false);foreign_workspace:=public.studio_provision(outsider,'Other panel',false);
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(wallet,'Panel wallet','modal:queue-panel-fixture','usd_micro','recurring',true,100,now(),now()+interval '1 hour');
 insert into public.studio_video_wallet_access values(wallet,workspace),(wallet,foreign_workspace);
 fixture:=pg_temp.queue_chapter(actor,workspace,wallet);
 snapshot:=public.studio_video_queue_snapshot(workspace,actor);
 if jsonb_array_length(snapshot->'entries')<>1 or snapshot#>>'{entries,0,state}'<>'prepared' then raise exception 'Prepared chapter missing';end if;
 if snapshot#>>'{queue,reservation_enabled}'<>'false' or exists(select 1 from public.studio_video_jobs where episode_id=(fixture->>'episode_id')::uuid) then raise exception 'Read dispatched work';end if;
 begin perform public.studio_video_queue_snapshot(workspace,outsider);raise exception 'Foreign member accepted';exception when insufficient_privilege then null;end;
 if public.studio_video_queue_snapshot(foreign_workspace,outsider)->'entries'<>'[]'::jsonb then raise exception 'Foreign episode leaked';end if;
 insert into public.studio_modal_wallet_config values(wallet,'queue-panel-fixture',1000,'test/evidence',now()+interval '1 hour','test/zero',now()+interval '1 hour',true);
 insert into public.studio_modal_observations values(wallet,jsonb_build_object('execution_sha256',repeat('b',64),'billed_units',0,'per_shot_units',10,'valid_until',now()+interval '1 hour'),now());
 update public.studio_video_compatibility set provider_id='modal-wan-s2v-h100-v1' where series_id=(fixture->>'series_id')::uuid;
 snapshot:=public.studio_video_queue_snapshot(workspace,actor);
 if snapshot#>>'{providers,0,available}'<>'true' or snapshot#>>'{entries,0,shots,0,quotes,0,units}'<>'10' then raise exception 'Verified server quote missing';end if;
 entry:=(public.studio_video_enqueue(workspace,actor,gen_random_uuid(),(fixture->>'episode_id')::uuid,repeat('a',64))->>'id')::uuid;
 snapshot:=public.studio_video_queue_snapshot(workspace,actor);
 if snapshot#>>'{entries,0,state}'<>'pending' or snapshot#>>'{queue,cursor_revision}'<>'0' then raise exception 'Enqueue must not advance cursor';end if;
 foreign_fixture:=pg_temp.queue_chapter(outsider,foreign_workspace,wallet);
 perform public.studio_reserve_video(foreign_workspace,outsider,gen_random_uuid(),(foreign_fixture->>'episode_id')::uuid,repeat('a',64),foreign_fixture->'plan');
 update public.studio_video_jobs set state='unknown' where episode_id=(foreign_fixture->>'episode_id')::uuid;
 snapshot:=public.studio_video_queue_snapshot(workspace,actor);
 if snapshot#>>'{providers,0,available}'<>'false' or snapshot#>>'{wallets,0,held_units}'<>'50' or jsonb_array_length(snapshot->'entries')<>1 then raise exception 'Shared uncertain wallet not held privately';end if;
 perform public.studio_video_queue_cancel(workspace,actor,entry,0);
 if public.studio_video_queue_snapshot(workspace,actor)->'entries'<>'[]'::jsonb then raise exception 'Cancelled queue reappeared';end if;
 if has_function_privilege('authenticated','public.studio_video_queue_snapshot(uuid,uuid)','execute') or has_function_privilege('anon','public.studio_video_queue_snapshot(uuid,uuid)','execute') then raise exception 'Snapshot exposed';end if;
end $$;
rollback;