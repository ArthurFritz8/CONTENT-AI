\set ON_ERROR_STOP on
begin;
create function pg_temp.native_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Native executor assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();w uuid;wallet uuid;sid uuid;req uuid:=gen_random_uuid();r jsonb;bib jsonb;pref jsonb;profile jsonb;run jsonb;changed jsonb;tasks jsonb:='[]';
 iid uuid;eid uuid;token uuid:=gen_random_uuid();other_token uuid:=gen_random_uuid();sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();fingerprint text:=repeat('f',64);i int;script jsonb;qa jsonb;scene jsonb;scenes jsonb:='[]';cuts jsonb:='[]';clip jsonb;script_text text;qa_text text;output jsonb;voice text;
begin
 w:=public.studio_provision(actor,'Native executor test',false);
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 perform public.studio_story_claim(w,actor,req,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref));
 sid:=public.studio_story_save(w,actor,req,bib);
 -- Seed the future, reviewed native binding as an operator. Ordinary admission
 -- remains closed: the panel cannot call this legacy narrative helper.
 r:=public.studio_story_next_illustrated(w,actor,sid);iid:=(r->>'idea_id')::uuid;
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 wallet:=public.register_auray_monitor(w,encode(sha256(convert_to('{"account":'||to_jsonb(account)::text||',"provider":"auray"}','UTF8')),'hex'),'[]');
 update public.studio_video_wallets set remaining_units=30,checked_at=now(),valid_until=now()+interval '5 minutes' where id=wallet;
 profile:=jsonb_build_object('version','auray-native-1.0.0','model','auray-ai/minimax-h3/text-to-video','contract_sha256',repeat('d',64),
  'native_voice_acknowledged',true,'voice_policy','provider_generated_review','example',jsonb_build_object('id',sample,'sha256',repeat('e',64)),
  'references',jsonb_build_array(jsonb_build_object('character_id','lia','sha256',repeat('b',64)),jsonb_build_object('character_id','rui','sha256',repeat('b',64))));
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256,legacy_identity) values(sid,w,profile,repeat('a',64),false);
 insert into public.studio_chapter_presentations values(sid,1,1,'cinematic_3d');
 insert into public.studio_chapter_productions values(sid,1,repeat('a',64));
 insert into public.studio_story_style_samples(id,workspace_id,sample,path,ready) values(sample,w,jsonb_build_object('id',sample,'sha256',repeat('e',64),'source','auray','style_id','cinematic_3d','review_scope','reviewed_sample'),w||'/story-samples/'||sample||'/'||repeat('e',64)||'.mp4',true);
 for i in 0..2 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat((i+1)::text,64),'job_id','video_'||repeat((i+1)::text,64),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',fingerprint,'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),
  'draft',jsonb_build_object('summary','Lia e Rui encontram a chave e decidem procurar a porta da feira.','scenes',jsonb_build_array(
   jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Então vamos descobrir juntos!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')))),
  'reserved_at',now(),'account_id',account,'key_id','fixture','period',to_char(now() at time zone 'UTC','YYYY-MM'),'contract_sha256',repeat('d',64),
  'initial_plan_remaining',30,'initial_key_remaining',30,'reserved_credits',15,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);
 perform pg_temp.native_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='native_setup_required','migration does not enable generation');
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":true}') on conflict(key) do update set value=excluded.value;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{initial_key_remaining}','14'));raise exception 'Incomplete chapter budget accepted';exception when check_violation then null;end;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{account_id}',to_jsonb(gen_random_uuid())));raise exception 'Wrong physical account accepted';exception when check_violation then null;end;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{profile,native_voice_acknowledged}','false'));raise exception 'Unacknowledged voices accepted';exception when check_violation then null;end;
 perform pg_temp.native_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='reserved','full chapter reserve accepted');
 perform pg_temp.native_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='existing','duplicate admission reuses chapter');
 perform pg_temp.native_assert((select count(*)=1 from public.studio_native_runs where wallet_id=wallet and held),'one complete chapter hold');
 r:=public.studio_video_overview(w,actor);
 perform pg_temp.native_assert(r#>>'{wallets,0,reserved_units}'='15','native reservation visible separately from raw provider balance');
 perform pg_temp.native_assert(position('account_id' in r::text)=0 and position('key_id' in r::text)=0,'wallet overview never discloses native account credentials');
 perform pg_temp.native_assert(public.claim_native_chapter(eid,token)->>'code'='claimed','native worker claims shared account');
 perform pg_temp.native_assert(public.claim_auray_sync(wallet,other_token)->>'code'='waiting','monitor cannot take the active generator lease');
 perform pg_temp.native_assert(public.claim_native_chapter(eid,other_token)->>'code'='waiting','duplicate native worker waits');
 begin perform public.save_native_chapter(eid,other_token,run);raise exception 'Stale worker saved';exception when insufficient_privilege then null;end;
 changed:=jsonb_set(run,'{revision}','1');changed:=jsonb_set(changed,'{tasks,0,phase}','"submission_started"');
 perform public.save_native_chapter(eid,token,changed);perform public.save_native_chapter(eid,token,changed);run:=changed;
 perform pg_temp.native_assert(public.studio_video_overview(w,actor)#>>'{wallets,0,balance_fresh}'='false','accepted or uncertain charge invalidates old balance without erasing history');
 perform pg_temp.native_assert((select remaining_units=30 from public.studio_video_wallets where id=wallet),'historical amount preserved until real refresh');
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{tasks,0,phase}','"planned"');
 begin perform public.save_native_chapter(eid,token,changed);raise exception 'Accepted identity reset to planned';exception when check_violation then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{tasks,1,phase}','"submission_started"');
 begin perform public.save_native_chapter(eid,token,changed);raise exception 'Two native jobs submitted together';exception when check_violation then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{tasks,0,job_id}',to_jsonb('video_'||repeat('a',64)));
 begin perform public.save_native_chapter(eid,token,changed);raise exception 'Job identity changed';exception when check_violation then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{budget_reconciled}','true');
 begin perform public.save_native_chapter(eid,token,changed);raise exception 'Unknown charge released';exception when check_violation then null;end;
 update public.system_config set value='{"native_chapter_enabled":false}' where key='story_production';
 begin perform public.guard_native_chapter(eid,token,true);raise exception 'Feature switch allowed new POST';exception when check_violation then null;end;
 perform public.guard_native_chapter(eid,token,false);
 perform public.finish_native_chapter(eid,token);
 perform pg_temp.native_assert((select held from public.studio_native_runs where episode_id=eid),'releasing lease never releases reserved credits');
 perform public.claim_auray_sync(wallet,other_token);
 begin perform public.finish_native_chapter(eid,token);raise exception 'Old native worker cleared monitor lease';exception when insufficient_privilege then null;end;
 perform public.finish_auray_sync(wallet,other_token,true);
 perform public.claim_native_chapter(eid,other_token);
 begin perform public.guard_native_chapter(eid,token);raise exception 'Expired native token reused';exception when insufficient_privilege then null;end;
 -- Complete the exact same three jobs; no episode transition happens until the
 -- private script and assembly receipt match the immutable stored byte hashes.
 for i in 0..2 loop
  if i>0 then run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"submission_started"');perform public.save_native_chapter(eid,other_token,run);end if;
  run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"waiting"');
  run:=jsonb_set(jsonb_set(run,array['tasks',i::text,'charged_credits'],'5'),array['tasks',i::text,'settled'],'true');perform public.save_native_chapter(eid,other_token,run);
  clip:=jsonb_build_object('request_key',run#>>array['tasks',i::text,'request_key'],'sha256',repeat((i+4)::text,64),'frames',124,'path','episodes/'||eid||'/native/'||repeat((i+4)::text,64)||'.mp4');
  run:=jsonb_set(jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"ready"'),array['tasks',i::text,'clip'],clip);perform public.save_native_chapter(eid,other_token,run);
  voice:=case when i=1 then 'rui' else 'lia' end;
  scene:=jsonb_build_object('id','take_'||i,'order',i,'narration_text',run#>>array['draft','scenes',i::text,'narration_text'],'story_visual',run#>array['draft','scenes',i::text,'visual'],
    'duration_seconds',5.166666666666667,'transition','cut','ken_burns','static','asset_landscape',null,
    'asset_portrait',jsonb_build_object('url','https://fixture.supabase.co/storage/v1/object/authenticated/studio-private/'||(clip->>'path')),
    'native_animation',jsonb_build_object('shot_id','take_'||i,'character_id',voice,'reference_sha256',repeat('b',64),'request_key',clip->>'request_key','video_sha256',clip->>'sha256','frames',124));
  scenes:=scenes||jsonb_build_array(scene);
  cuts:=cuts||jsonb_build_array(jsonb_build_object('speaker',voice,'source_sha256',clip->>'sha256','frames',124,'original_audio',true,'audio_transport',jsonb_build_object('silent_reference',false,'correlation',0.99,'measured_lag_seconds',0.001)));
 end loop;
 script:=jsonb_build_object('episode_id',eid,'prompt_version','3.0.0','fiction',jsonb_build_object('context',run->'context','summary',run#>'{draft,summary}',
  'native_animation',jsonb_build_object('version','1.0.0','provider','auray','profile_sha256',repeat('a',64),'width',768,'height',1344,'output_fps',24,'voice_identity_preserved',false,'speech_transcription_verified',false,'human_review_required',true)),
  'scenes',scenes,'gap_seconds',0,'music',null,'sources','[]'::jsonb,'disclosures',jsonb_build_object('contains_synthetic_media',true,'commercial_content',false));
 qa:=jsonb_build_object('episode_id',eid,'fingerprint',fingerprint,'sha256',repeat('e',64),'script_hash',repeat('f',64),'policy_hash',repeat('d',64),
  'quality_policy',(select value from public.system_config where key='fact_check'),'width',768,'height',1344,'encoded_fps',24,'frames',372,'seconds',15.5,'cuts',cuts,'all_decoded_frames_pixel_identical',true,'video_reencoded',false,
  'audio_encoded_once_from_native_pcm',true,'decode_verified',true,'human_review_required',true,'voice_continuity_approved',false,'production_ready',false,'script_qa',jsonb_build_object('passed',true));
 script_text:=script::text;qa_text:=qa::text;
 output:=jsonb_build_object('sha256',repeat('e',64),'bytes',100,'path','episodes/'||eid||'/native/'||repeat('e',64)||'.mp4',
  'script_sha256',encode(sha256(convert_to(script_text,'UTF8')),'hex'),'qa_sha256',encode(sha256(convert_to(qa_text,'UTF8')),'hex'));
 output:=output||jsonb_build_object('script_path','episodes/'||eid||'/native/'||(output->>'script_sha256')||'.json','qa_path','episodes/'||eid||'/native/'||(output->>'qa_sha256')||'.json');
 run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),'{output}',output);perform public.save_native_chapter(eid,other_token,run);
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text||' ',qa_text);raise exception 'Changed script bytes accepted';exception when check_violation then null;end;
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,(qa||'{"video_reencoded":true}')::text);raise exception 'Changed QA accepted';exception when check_violation then null;end;
 perform pg_temp.native_assert(public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','native output mounted using measured non-integer frame duration');
 perform pg_temp.native_assert(public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','mount is idempotent');
 update public.system_config set value=value||'{"require_source_per_claim":false}' where key='fact_check';
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text);raise exception 'Obsolete quality policy accepted';exception when check_violation then null;end;
 update public.system_config set value=qa->'quality_policy' where key='fact_check';
 perform pg_temp.native_assert((select status='rendered' and approval_date is null and render_url like '%/authenticated/studio-private/episodes/%' from public.episodes where id=eid),'native movie stays private and awaits review');
 perform public.finish_native_chapter(eid,other_token);
 perform pg_temp.native_assert(not has_table_privilege('authenticated','public.studio_native_runs','select'),'private native state hidden from browser');
 perform pg_temp.native_assert(not has_function_privilege('authenticated','public.reserve_native_chapter(uuid,uuid,jsonb)','execute'),'browser cannot invent credit observations');
 perform pg_temp.native_assert(not has_function_privilege('anon','public.save_native_chapter(uuid,uuid,jsonb)','execute'),'anonymous cannot change checkpoints');
 perform pg_temp.native_assert(not has_function_privilege('service_role','public.complete_native_chapter_before_policy(uuid,uuid,text,text,text)','execute'),'worker cannot bypass current editorial policy');
 perform pg_temp.native_assert((select not enabled from public.studio_video_wallets where id=wallet),'native adapter does not enable old WAV wallet');
 perform pg_temp.native_assert((select status='rendered' from public.episodes where id=eid),'worker cannot approve or publish');
end $$;
rollback;
