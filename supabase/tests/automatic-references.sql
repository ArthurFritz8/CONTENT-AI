\set ON_ERROR_STOP on
begin;
create function pg_temp.ref_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Reference assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();other_actor uuid:=gen_random_uuid();w uuid;ow uuid;sid uuid;req uuid:=gen_random_uuid();b jsonb;pref jsonb;r jsonb;token uuid:=gen_random_uuid();idx int;job uuid;account text:=repeat('a',64);
begin
 w:=public.studio_provision(actor,'Automatic reference test',false);ow:=public.studio_provision(other_actor,'Other refs',false);
 b:='{"kind":"fruits","genre":"mystery","title":"A carta escondida","premise":"Duas frutas procuram uma carta que desapareceu durante a feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ff0000","personality":"Curiosa e sempre atenta.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#ff9900","personality":"Amigo leal mas impulsivo.","voice":"male"}],"chapters":[{"title":"A carta perdida","arc":"Lia encontra a carta e Rui admite que a guardou para proteger a amiga."}]}';
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 perform public.studio_story_claim(w,actor,req,jsonb_build_object('kind','fruits','genre','mystery','chapters',1,'presentation',pref));sid:=public.studio_story_save(w,actor,req,b);
 req:=gen_random_uuid();perform pg_temp.ref_assert(public.studio_reference_request(w,actor,sid,req,1,'cinematic_3d','lia')->>'code'='connection_required','no credential means no generation');
 insert into public.studio_connections(workspace_id,provider,status,metadata) values(w,'cloudflare_images','connected',jsonb_build_object('account_sha256',account));
 r:=public.studio_reference_request(w,actor,sid,req,1,'cinematic_3d','lia');perform pg_temp.ref_assert(r->>'code'='dispatch','explicit click admits a reference');
 perform pg_temp.ref_assert(public.studio_reference_request(w,actor,sid,req,1,'cinematic_3d','lia')->>'code'='planned','duplicate request does not create another');
 perform pg_temp.ref_assert(public.reference_recovery_jobs()='[]'::jsonb,'recent dispatch is not repeated');
 update public.studio_reference_jobs set dispatched_at=now()-interval '11 minutes' where id=req;
 perform pg_temp.ref_assert(public.reference_recovery_jobs()=jsonb_build_array(req),'lost dispatch can be recovered after bounded wait');
 perform pg_temp.ref_assert(public.reference_recovery_jobs()='[]'::jsonb,'recovery dispatcher is atomic and throttled');
 perform pg_temp.ref_assert(public.studio_reference_request(w,actor,sid,gen_random_uuid(),1,'cinematic_3d','lia')->>'code'='waiting','same character reuses pending request');
 begin perform public.studio_reference_view(ow,other_actor,sid);raise exception 'Cross workspace accepted';exception when insufficient_privilege then null;end;
 perform pg_temp.ref_assert(public.claim_reference_job(req,token)->>'code'='claimed','worker claims once');
 perform pg_temp.ref_assert(public.claim_reference_job(req,gen_random_uuid())->>'code'='submission_started','crash cannot repeat POST');
 begin update public.studio_series set bible=jsonb_set(bible,'{cast,0,name}','"Outra pessoa"') where id=sid;raise exception 'Changed active reference cast';exception when check_violation then null;end;
 perform public.finish_reference_job(req,token,'daily_quota_or_capacity',null);
 for idx in 2..6 loop
  job:=gen_random_uuid();perform pg_temp.ref_assert(public.studio_reference_request(w,actor,sid,job,1,'cinematic_3d','lia')->>'code'='dispatch','bounded explicit retry');
  perform public.claim_reference_job(job,token);perform public.finish_reference_job(job,token,'daily_quota_or_capacity',null);
 end loop;
 perform pg_temp.ref_assert(public.studio_reference_request(w,actor,sid,gen_random_uuid(),1,'cinematic_3d','lia')->>'code'='daily_limit','six account attempts bound unknown outcomes');
 perform pg_temp.ref_assert((select count(*)=6 from public.studio_reference_jobs where workspace_id=w),'no duplicate rows');
 perform pg_temp.ref_assert(not (public.studio_reference_view(w,actor,sid)->'connection' ? 'secret_id'),'connection view does not expose secret');
 perform pg_temp.ref_assert(not has_function_privilege('authenticated','public.claim_reference_job(uuid,uuid)','execute'),'credentials available only to service worker');
 perform pg_temp.ref_assert(not exists(select 1 from public.episodes where workspace_id=w),'creating references never creates video');
end $$;
rollback;
