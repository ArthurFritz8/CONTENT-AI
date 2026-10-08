\set ON_ERROR_STOP on
begin;
create function pg_temp.worker_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Worker assertion: %',label; end if; end $$;
do $$
declare actor uuid:=gen_random_uuid(); w uuid; sid uuid; eid uuid; wallet uuid:=gen_random_uuid();
 profile text:=repeat('a',64); execution text:=repeat('b',64); job uuid; lease uuid;
 cap text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 shot jsonb; plan jsonb; reply jsonb; receipt jsonb; manifests jsonb; prefix text;
begin
 w:=public.studio_provision(actor,'Worker audit',false);
 insert into public.studio_series(workspace_id,bible) values(w,'{"title":"Uma nova feira","kind":"fruits","genre":"drama","cast":[],"chapters":[]}') returning id into sid;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(sid,w,'{}',profile);
 insert into public.episodes(workspace_id,briefing) values(w,jsonb_build_object('story_context',jsonb_build_object('series_id',sid))) returning id into eid;
 update public.episodes set status='research' where id=eid;
 update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true}}',script_hash=repeat('d',64) where id=eid;
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(wallet,'Worker fixture','worker-fixture-'||wallet,'credits','recurring',true,20,now(),now()+interval '1 hour');
 insert into public.studio_video_wallet_access(wallet_id,workspace_id) values(wallet,w);
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,profile,wallet,'modal',execution,'dialogue','reviewed/control.mp4',actor);
 shot:=jsonb_build_object('id','talk','kind','dialogue','quality','approved_master','reference_sha256',repeat('e',64),'audio_sha256',repeat('f',64),
  'continuity',jsonb_build_object('series_id',sid,'profile_sha256',profile));
 plan:=jsonb_build_array(jsonb_build_object('shot_id','talk','wallet_id',wallet,'provider_id','modal','execution_sha256',execution,
  'reserved_units',10,'cash_cost',0,'script_sha256',repeat('d',64),'input',shot));
 reply:=public.studio_reserve_video(w,actor,gen_random_uuid(),eid,profile,plan); job:=(reply->'job_ids'->>0)::uuid;
 begin update public.studio_video_jobs set input=jsonb_set(input,'{prompt}','"changed after quotation"') where id=job; raise exception 'Reserved input changed'; exception when check_violation then null; end;
 begin update public.studio_video_jobs set reserved_units=1 where id=job; raise exception 'Reserved cost changed'; exception when check_violation then null; end;
 reply:=public.claim_video_job(job); lease:=(reply->>'token')::uuid;
 begin perform public.register_video_worker(job,gen_random_uuid(),cap); raise exception 'Wrong lease accepted'; exception when insufficient_privilege then null; end;
 reply:=public.register_video_worker(job,lease,cap); prefix:=reply->>'prefix';
 perform pg_temp.worker_assert(prefix=w||'/videos/'||eid||'/'||job||'/'||lease,'derived private location');
 perform pg_temp.worker_assert(public.register_video_worker(job,lease,cap)=reply,'registration idempotent');
 begin perform public.register_video_worker(job,lease,repeat('0',64)); raise exception 'Capability replaced'; exception when insufficient_privilege then null; end;
 begin perform public.begin_video_worker(job,repeat('0',64),'fc-fixture'); raise exception 'Foreign capability accepted'; exception when insufficient_privilege then null; end;
 update public.studio_video_wallets set checked_at=now()-interval '6 minutes' where id=wallet;
 perform pg_temp.worker_assert(public.begin_video_worker(job,cap,'fc-fixture')->>'code'='paused','stale balance blocks GPU start');
 update public.studio_video_wallets set checked_at=now() where id=wallet;
 update public.studio_video_compatibility set revoked_at=now() where series_id=sid;
 perform pg_temp.worker_assert(public.begin_video_worker(job,cap,'fc-fixture')->>'code'='series_incompatible','revocation before GPU');
 update public.studio_video_compatibility set revoked_at=null where series_id=sid;
 perform pg_temp.worker_assert(public.begin_video_worker(job,cap,'fc-fixture')->>'code'='started','one start');
 perform pg_temp.worker_assert(public.begin_video_worker(job,cap,'fc-fixture')->>'code'='already_started','CPU retry cannot restart inference');
 begin perform public.begin_video_worker(job,cap,'fc-another'); raise exception 'Foreign external call accepted'; exception when insufficient_privilege then null; end;
 perform pg_temp.worker_assert(public.record_video_submission(job,lease,'accepted','fc-fixture')->>'code'='saved','callback can precede runner');
 perform public.record_video_submission(job,lease,'unknown');
 perform pg_temp.worker_assert((select state='accepted' and external_id='fc-fixture' from public.studio_video_jobs where id=job),'late uncertainty does not downgrade acknowledged acceptance');
 perform public.fail_video_worker(job,cap,'TRANSPORT_FAILED');
 perform public.record_video_submission(job,lease,'unknown');
 perform pg_temp.worker_assert((select state='unknown' and external_id='fc-fixture' and not balance_reconciled from public.studio_video_jobs where id=job),'failure retains identity and funds');
 begin perform public.record_video_submission(job,lease,'accepted','fc-another'); raise exception 'External identity replaced'; exception when check_violation then null; end;
 perform pg_temp.worker_assert(public.begin_video_worker(job,cap,'fc-fixture')->>'code'='already_started','failure never starts a second GPU');
 receipt:=jsonb_build_object('human_review_required',true,'lip_sync_validated',false,'execution_sha256',execution,'reference_sha256',repeat('e',64),'input_audio_sha256',repeat('f',64));
 manifests:=jsonb_build_object('native',jsonb_build_object('sha256',repeat('1',64),'size',100),'fluid',jsonb_build_object('sha256',repeat('2',64),'size',120));
 begin perform public.complete_video_worker(job,cap,jsonb_set(receipt,'{reference_sha256}',to_jsonb(repeat('0',64))),manifests); raise exception 'Wrong reference accepted'; exception when check_violation then null; end;
 begin perform public.complete_video_worker(job,cap,receipt,'{"fluid":{"sha256":null,"size":null}}'); raise exception 'Missing output accepted'; exception when check_violation then null; end;
 update public.studio_video_worker_tickets set expires_at=now()-interval '1 minute' where job_id=job;
 begin perform public.complete_video_worker(job,cap,receipt,manifests); raise exception 'Expired capability accepted'; exception when insufficient_privilege then null; end;
 perform pg_temp.worker_assert(public.complete_video_worker(job,cap,receipt,manifests,true)->>'code'='saved','service-only storage recovery after capability expiry');
 perform pg_temp.worker_assert(public.complete_video_worker(job,cap,receipt,manifests,true)->>'code'='saved','recovery idempotent');
 perform pg_temp.worker_assert((select state='completed' and output_path=prefix||'/fluid.mp4' and charged_units is null and not balance_reconciled from public.studio_video_jobs where id=job),'completion keeps unbilled reservation');
 perform pg_temp.worker_assert((select status='script' from public.episodes where id=eid),'does not approve or publish');
 perform pg_temp.worker_assert(not has_function_privilege('anon','public.complete_video_worker(uuid,text,jsonb,jsonb,boolean)','execute'),'public cannot invoke privileged recovery');
 perform pg_temp.worker_assert(not has_function_privilege('authenticated','public.begin_video_worker(uuid,text,text)','execute'),'browser cannot invoke begin directly');
end $$;
rollback;
