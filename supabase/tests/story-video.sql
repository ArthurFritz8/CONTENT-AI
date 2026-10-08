\set ON_ERROR_STOP on
begin;
create function pg_temp.video_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Video assertion: %',label; end if; end $$;
do $$
declare actor uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); w uuid; ow uuid; sid uuid; osid uuid; eid uuid; oeid uuid;
 wallet uuid:=gen_random_uuid(); request uuid:=gen_random_uuid(); profile text:=repeat('a',64); execution text:=repeat('b',64);
 expected_script_hash text:=repeat('c',64); bible jsonb; shot jsonb; plan jsonb; reply jsonb; job uuid; token uuid;
begin
 w:=public.studio_provision(actor,'Video test',false); ow:=public.studio_provision(other,'Other video',false);
 bible:='{"title":"O segredo da feira","kind":"fruits","genre":"mystery","cast":[],"chapters":[]}';
 insert into public.studio_series(workspace_id,bible) values(w,bible) returning id into sid;
 insert into public.studio_series(workspace_id,bible) values(ow,bible) returning id into osid;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(sid,w,'{}',profile),(osid,ow,'{}',profile);
 begin update public.studio_series_production set profile='{"changed":true}' where series_id=sid; raise exception 'Identity changed'; exception when check_violation then null; end;
 insert into public.episodes(workspace_id,briefing) values(w,jsonb_build_object('story_context',jsonb_build_object('series_id',sid))) returning id into eid;
 insert into public.episodes(workspace_id,briefing) values(ow,jsonb_build_object('story_context',jsonb_build_object('series_id',osid))) returning id into oeid;
 update public.episodes set status='research' where id in (eid,oeid);
 update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true}}',script_hash=case when id=eid then expected_script_hash else repeat('d',64) end where id in (eid,oeid);
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(wallet,'Shared monthly source','test-'||wallet,'credits','recurring',true,20,now(),now()+interval '1 hour');
 insert into public.studio_video_wallet_access(wallet_id,workspace_id) values(wallet,w),(wallet,ow);
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,profile,wallet,'modal',execution,'dialogue','reviewed/control.mp4',actor),(osid,profile,wallet,'modal',execution,'dialogue','reviewed/other.mp4',other);
 shot:=jsonb_build_object('id','talk','kind','dialogue','quality','approved_master','continuity',jsonb_build_object('series_id',sid,'profile_sha256',profile));
 plan:=jsonb_build_array(jsonb_build_object('shot_id','talk','wallet_id',wallet,'provider_id','modal','execution_sha256',execution,'reserved_units',10,'cash_cost',0,'script_sha256',expected_script_hash,'input',shot));
 begin perform public.studio_reserve_video(w,other,request,eid,profile,plan); raise exception 'Foreign actor accepted'; exception when insufficient_privilege then null; end;
 reply:=public.studio_reserve_video(w,actor,request,eid,profile,plan);
 perform pg_temp.video_assert(reply->>'code'='reserved','reservation'); job:=(reply->'job_ids'->>0)::uuid;
 perform pg_temp.video_assert(public.studio_reserve_video(w,actor,request,eid,profile,plan)=reply,'retry is idempotent');
 perform pg_temp.video_assert((select count(*)=1 from public.studio_video_jobs where episode_id=eid),'one job');
 perform pg_temp.video_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,available_units}')::int=10,'held funds excluded');
 plan:=jsonb_set(plan,'{0,input,continuity,series_id}',to_jsonb(osid::text));
 plan:=jsonb_set(plan,'{0,script_sha256}',to_jsonb(repeat('d',64))); plan:=jsonb_set(plan,'{0,reserved_units}','12');
 perform pg_temp.video_assert(public.studio_reserve_video(ow,other,gen_random_uuid(),oeid,profile,plan)->>'code'='insufficient_capacity','shared wallet across workspaces');
 perform pg_temp.video_assert(not exists(select 1 from public.studio_video_jobs where episode_id=oeid),'failure atomic');
 update public.studio_video_compatibility set revoked_at=now() where series_id=sid;
 perform pg_temp.video_assert(public.claim_video_job(job)->>'code'='series_incompatible','revocation checked before send');
 update public.studio_video_compatibility set revoked_at=null where series_id=sid;
 reply:=public.claim_video_job(job); token:=(reply->>'token')::uuid;
 perform pg_temp.video_assert(reply->>'code'='claimed','submission lease');
 perform pg_temp.video_assert(public.claim_video_job(job)->>'code'='reconcile','double submission blocked');
 begin perform public.record_video_submission(job,gen_random_uuid(),'accepted','external-1'); raise exception 'Wrong lease accepted'; exception when insufficient_privilege then null; end;
 perform public.record_video_submission(job,token,'unknown');
 perform pg_temp.video_assert(public.claim_video_job(job)->>'state'='unknown','unknown never reclaimed');
 perform pg_temp.video_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,available_units}')::int=10,'unknown keeps budget');
 perform public.record_video_submission(job,token,'accepted','external-1');
 perform public.finish_video_job(job,token,'private/result.mp4',repeat('e',64),7);
 perform public.finish_video_job(job,token,'private/result.mp4',repeat('e',64),7);
 perform pg_temp.video_assert(public.record_video_submission(job,token,'accepted','external-1')->>'code'='saved','late duplicate acceptance is harmless');
 begin perform public.record_video_submission(job,token,'rejected'); raise exception 'Accepted job freed as non-acceptance'; exception when check_violation then null; end;
 perform pg_temp.video_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,available_units}')::int=10,'completion awaits billing');
 perform public.reconcile_video_wallet(wallet,13,now(),now()+interval '1 hour',array[job]);
 perform pg_temp.video_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,available_units}')::int=13,'charge not subtracted twice');
 perform pg_temp.video_assert(public.studio_reserve_video(ow,other,gen_random_uuid(),oeid,profile,plan)->>'code'='reserved','other workspace can use remaining funds');
 perform pg_temp.video_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,reserved_units}')::int=12,'global reservations visible without exposing other jobs');
 perform pg_temp.video_assert(jsonb_array_length(public.studio_video_overview(ow,other)->'series_profiles')=1,'profiles workspace scoped');
 perform pg_temp.video_assert(not has_function_privilege('authenticated','public.studio_reserve_video(uuid,uuid,uuid,uuid,text,jsonb)','execute'),'no browser reservation RPC');
 perform pg_temp.video_assert(not has_function_privilege('anon','public.claim_video_job(uuid)','execute'),'no public worker claim');
end $$;
rollback;
