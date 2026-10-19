\set ON_ERROR_STOP on
\ir video-queue-fixture.sql
create table public.video_queue_concurrency_fixture(
 scenario text,slot int,actor uuid,workspace uuid,queue uuid,request uuid,plan jsonb,wallet uuid,primary key(scenario,slot)
);
do $$
declare actor uuid;workspace uuid;cursor_actor uuid:=gen_random_uuid();cursor_workspace uuid;
 shared_wallet uuid:=gen_random_uuid();cursor_wallet uuid:=gen_random_uuid();fixture jsonb;entry uuid;slot int;
 shared_actors uuid[]:=array[gen_random_uuid(),gen_random_uuid()];shared_workspaces uuid[];
begin
 update public.system_config set value='{"reservation_enabled":true}' where key='video_queue';
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(shared_wallet,'Shared race','race-shared-'||shared_wallet,'credits','recurring',true,50,now(),now()+interval '1 hour'),
  (cursor_wallet,'Cursor race','race-cursor-'||cursor_wallet,'credits','recurring',true,600,now(),now()+interval '1 hour');
 cursor_workspace:=public.studio_provision(cursor_actor,'Cursor race',false);
 insert into public.studio_video_wallet_access values(cursor_wallet,cursor_workspace);
 shared_workspaces:=array[public.studio_provision(shared_actors[1],'Shared wallet race one',false),
  public.studio_provision(shared_actors[2],'Shared wallet race two',false)];
 insert into public.studio_video_wallet_access values(shared_wallet,shared_workspaces[1]),(shared_wallet,shared_workspaces[2]);
 for slot in 1..12 loop
  actor:=shared_actors[1+slot%2];workspace:=shared_workspaces[1+slot%2];
  fixture:=pg_temp.queue_chapter(actor,workspace,shared_wallet);
  entry:=(public.studio_video_enqueue(workspace,actor,gen_random_uuid(),(fixture->>'episode_id')::uuid,repeat('a',64))->>'id')::uuid;
  insert into public.video_queue_concurrency_fixture values('shared',slot,actor,workspace,entry,gen_random_uuid(),fixture->'plan',shared_wallet);
  fixture:=pg_temp.queue_chapter(cursor_actor,cursor_workspace,cursor_wallet);
  entry:=(public.studio_video_enqueue(cursor_workspace,cursor_actor,gen_random_uuid(),(fixture->>'episode_id')::uuid,repeat('a',64))->>'id')::uuid;
  insert into public.video_queue_concurrency_fixture values('cursor',slot,cursor_actor,cursor_workspace,entry,gen_random_uuid(),fixture->'plan',cursor_wallet);
 end loop;
end $$;