\set ON_ERROR_STOP on
begin;
create function pg_temp.setup_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Setup assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid; fw uuid; sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); id1 uuid:=gen_random_uuid(); id2 uuid:=gen_random_uuid(); a1 uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); r jsonb; r2 jsonb; profile jsonb; bible jsonb;
begin
 w:=public.studio_provision(actor,'Setup test',false);fw:=public.studio_provision(outsider,'Other setup',false);
 bible:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."}]}';
 insert into public.studio_series(id,workspace_id,bible) values(sid,w,bible),(sid2,w,bible);
 begin perform public.studio_production_setup_view(w,outsider,sid);raise exception 'Foreign actor accepted';exception when insufficient_privilege then null;end;
 begin perform public.studio_production_media_reserve(w,actor,sid,id1,'missing','reference',repeat('1',64),500,'{"mime":"image/png","width":704,"height":1280}');raise exception 'Foreign character accepted';exception when check_violation then null;end;
 r:=public.studio_production_media_reserve(w,actor,sid,id1,'lia','reference',repeat('1',64),500,'{"mime":"image/png","width":704,"height":1280}');
 perform pg_temp.setup_assert(r->>'path'=w||'/story-profile/'||sid||'/'||id1||'/'||repeat('1',64)||'.png','derived private path');
 perform pg_temp.setup_assert(public.studio_production_media_reserve(w,actor,sid,id1,'lia','reference',repeat('1',64),500,'{"mime":"image/png","width":704,"height":1280}')=r,'upload replay reserves once');
 perform pg_temp.setup_assert(public.studio_production_media_reserve(w,actor,sid,gen_random_uuid(),'lia','reference',repeat('1',64),500,'{"mime":"image/png","width":704,"height":1280}')=r,'same immutable file with a new browser request reuses its slot');
 begin perform public.studio_production_media_reserve(w,actor,sid,id1,'lia','reference',repeat('2',64),500,'{"mime":"image/png","width":704,"height":1280}');raise exception 'Changed retry accepted';exception when insufficient_privilege then null;end;
 perform pg_temp.setup_assert(public.studio_story_next(w,actor,sid)->>'code'='profile_incomplete','partial setup cannot start illustrated chapter');
 perform public.studio_production_media_ready(w,actor,id1,repeat('1',64));perform public.studio_production_media_ready(w,actor,id1,repeat('1',64));
 begin perform public.studio_production_media_read(fw,outsider,id1);raise exception 'Foreign file read';exception when no_data_found then null;end;
 r2:=public.studio_production_media_reserve(w,actor,sid,id2,'rui','reference',repeat('2',64),500,'{"mime":"image/png","width":704,"height":1280}');perform public.studio_production_media_ready(w,actor,id2,repeat('2',64));
 perform pg_temp.setup_assert(public.studio_profile_voices_request(w,actor,sid)->>'code'='setup_required','voice workflows default closed');
 insert into public.system_config(key,value) values('story_production','{"profile_voices_enabled":true,"animated_preparation_enabled":false}') on conflict(key) do update set value=excluded.value;
 perform pg_temp.setup_assert(public.studio_profile_voices_request(w,actor,sid)->>'code'='dispatch','one voice dispatch');
 perform pg_temp.setup_assert(public.studio_profile_voices_request(w,actor,sid)->>'code'='waiting','duplicate click throttled');
 perform pg_temp.setup_assert(not (public.studio_production_setup_view(w,actor,sid)->>'voice_retry_allowed')::boolean,'UI blocks duplicate dispatch during cooldown');
 perform pg_temp.setup_assert(public.claim_profile_voices(sid,token)->>'code'='claimed','voice lease');
 perform pg_temp.setup_assert(public.claim_profile_voices(sid,gen_random_uuid())->>'code'='waiting','duplicate runner cannot synthesize');
 begin perform public.studio_production_media_reserve(w,actor,sid,a1,'lia','voice_sample',repeat('3',64),32044,'{"mime":"audio/wav","seconds":1,"engine":"edge","version":"edge-tts-7.2.8-rate0","voice_id":"pt-BR-AntonioNeural"}');raise exception 'Changed voice accepted';exception when check_violation then null;end;
 perform public.studio_production_media_reserve(w,actor,sid,a1,'lia','voice_sample',repeat('3',64),32044,'{"mime":"audio/wav","seconds":1,"engine":"edge","version":"edge-tts-7.2.8-rate0","voice_id":"pt-BR-FranciscaNeural"}');perform public.studio_production_media_ready(w,actor,a1,repeat('3',64));
 perform pg_temp.setup_assert(public.finish_profile_voices(sid,gen_random_uuid(),true)->>'code'='stale','old callback rejected');
 perform pg_temp.setup_assert(public.finish_profile_voices(sid,token,true)->>'code'='failed','partial voices never mark ready');
 update public.studio_production_setup set dispatched_at=now()-interval '13 minutes' where series_id=sid;
 perform pg_temp.setup_assert((public.studio_production_setup_view(w,actor,sid)->>'voice_retry_allowed')::boolean,'UI can recover expired or failed dispatch');
 perform public.studio_profile_voices_request(w,actor,sid);r:=public.claim_profile_voices(sid,token);
 perform pg_temp.setup_assert(jsonb_array_length(r->'media')=1,'retry reuses completed voice');
 perform public.studio_production_media_reserve(w,actor,sid,a2,'rui','voice_sample',repeat('4',64),32044,'{"mime":"audio/wav","seconds":1,"engine":"edge","version":"edge-tts-7.2.8-rate0","voice_id":"pt-BR-AntonioNeural"}');perform public.studio_production_media_ready(w,actor,a2,repeat('4',64));
 perform pg_temp.setup_assert(public.finish_profile_voices(sid,token,true)->>'code'='ready','whole cast voices ready');
 profile:=jsonb_build_object('version','1.0.0','orientation','portrait','short_edge',704,'output_fps',60,'style','Animação 3D cinematográfica com olhos nítidos e movimentos naturais.',
  'references',jsonb_build_array(jsonb_build_object('character_id','lia','path',(select path from public.studio_production_media where id=id1),'sha256',repeat('1',64)),jsonb_build_object('character_id','rui','path',r2->>'path','sha256',repeat('2',64))),
  'voices',jsonb_build_array(jsonb_build_object('character_id','lia','engine','edge','version','edge-tts-7.2.8-rate0','voice_id','pt-BR-FranciscaNeural','sample_sha256',repeat('3',64)),jsonb_build_object('character_id','rui','engine','edge','version','edge-tts-7.2.8-rate0','voice_id','pt-BR-AntonioNeural','sample_sha256',repeat('4',64))));
 begin perform public.studio_production_finalize(w,actor,sid,profile||'{"voices":[]}',repeat('a',64));raise exception 'Partial identity saved';exception when check_violation then null;end;
 perform pg_temp.setup_assert(public.studio_production_finalize(w,actor,sid,profile,repeat('a',64))->>'code'='saved','complete identity saved');
 perform pg_temp.setup_assert(public.studio_production_finalize(w,actor,sid,profile,repeat('a',64))->>'code'='saved','finalize replay idempotent');
 perform pg_temp.setup_assert(not (public.studio_production_setup_view(w,actor,sid)->>'can_configure')::boolean,'saved identity read-only');
 perform pg_temp.setup_assert(public.studio_story_next(w,actor,sid)->>'code'='animation_setup_required','identity alone cannot authorize production');
 perform pg_temp.setup_assert(not exists(select 1 from public.studio_video_compatibility where series_id=sid),'user approval does not qualify providers');
 perform pg_temp.setup_assert(not exists(select 1 from public.studio_video_jobs where workspace_id=w),'setup never queues GPU');
 begin update public.studio_production_media set sha256=repeat('c',64) where id=id1;raise exception 'Saved reference changed';exception when check_violation then null;end;
 begin perform public.studio_production_media_reserve(w,actor,sid,gen_random_uuid(),'lia','reference',repeat('c',64),500,'{"mime":"image/png","width":704,"height":1280}');raise exception 'Frozen identity changed';exception when check_violation then null;end;
 perform public.studio_story_next(w,actor,sid2);
 begin perform public.studio_production_media_reserve(w,actor,sid2,gen_random_uuid(),'lia','reference',repeat('c',64),500,'{"mime":"image/png","width":704,"height":1280}');raise exception 'Started story converted';exception when check_violation then null;end;
 perform pg_temp.setup_assert(not has_function_privilege('authenticated','public.studio_production_finalize(uuid,uuid,uuid,jsonb,text)','execute'),'browser cannot invoke service RPC');
end $$;
rollback;
