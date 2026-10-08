\set ON_ERROR_STOP on
-- Disposable audit database only; fixtures are removed by the verification script.
create table public.video_concurrency_fixture(slot int primary key,actor uuid,workspace uuid,episode uuid,request uuid,plan jsonb,wallet uuid);
do $$
declare actor uuid:=gen_random_uuid(); w uuid; sid uuid; eid uuid; wallet uuid:=gen_random_uuid(); profile text:=repeat('a',64); execution text:=repeat('b',64); script_sha text;
begin
 w:=public.studio_provision(actor,'Video concurrency audit',false);
 insert into public.studio_series(workspace_id,bible) values(w,'{}') returning id into sid;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(sid,w,'{}',profile);
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(wallet,'Concurrency wallet','concurrency-'||wallet,'credits','recurring',true,30,now(),now()+interval '1 hour');
 insert into public.studio_video_wallet_access values(wallet,w);
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,profile,wallet,'modal',execution,'dialogue','test/control.mp4',actor);
 for n in 1..12 loop
  script_sha:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.episodes(workspace_id,briefing) values(w,jsonb_build_object('story_context',jsonb_build_object('series_id',sid))) returning id into eid;
  update public.episodes set status='research' where id=eid;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true}}',script_hash=script_sha where id=eid;
  insert into public.video_concurrency_fixture values(n,actor,w,eid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('shot_id','talk','wallet_id',wallet,
   'provider_id','modal','execution_sha256',execution,'reserved_units',10,'cash_cost',0,'script_sha256',script_sha,
   'input',jsonb_build_object('id','talk','kind','dialogue','quality','approved_master','continuity',jsonb_build_object('series_id',sid,'profile_sha256',profile)))),wallet);
 end loop;
end $$;
