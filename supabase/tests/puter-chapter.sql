\set ON_ERROR_STOP on
-- Disposable local PostgreSQL only. Never install a fake Vault in a hosted project.
begin;
do $$begin
 if to_regnamespace('vault') is not null or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
  raise exception 'Puter Vault fixture requires an empty local test namespace';
 end if;
end $$;
create schema vault;
create table vault.fixture_secrets(id uuid primary key default gen_random_uuid(),value text);
create view vault.decrypted_secrets as select id,value as decrypted_secret from vault.fixture_secrets;
create function vault.create_secret(p_value text) returns uuid language sql as $$insert into vault.fixture_secrets(value) values(p_value) returning id$$;
create function vault.update_secret(p_id uuid,p_value text) returns void language sql as $$update vault.fixture_secrets set value=p_value where id=p_id$$;
create function pg_temp.native_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Puter chapter assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;sid uuid;req uuid:=gen_random_uuid();r jsonb;bib jsonb;pref jsonb;profile jsonb;run jsonb;changed jsonb;tasks jsonb:='[]';
 iid uuid;eid uuid;token uuid:=gen_random_uuid();other_token uuid:=gen_random_uuid();sample uuid:=gen_random_uuid();account uuid;fingerprint text:=repeat('f',64);i int;script jsonb;qa jsonb;scene jsonb;scenes jsonb:='[]';cuts jsonb:='[]';clip jsonb;script_text text;qa_text text;output jsonb;voice text;observation jsonb;
begin
 w:=public.studio_provision(actor,'Native executor test',false);
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"puter","voice_policy":"approved_variants"}';
 perform public.studio_story_claim(w,actor,req,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref));
 sid:=public.studio_story_save(w,actor,req,bib);
 -- Seed the future, reviewed native binding as an operator. Ordinary admission
 -- remains closed: the panel cannot call this legacy narrative helper.
 r:=public.studio_story_next_illustrated(w,actor,sid);iid:=(r->>'idea_id')::uuid;
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 observation:=jsonb_build_object('provider','puter','account_sha256',repeat('c',64),'checked_at',now(),'remaining_credits',1000,'monthly_allowance',1000,
  'storage_free_bytes',20000000,'unit','credits','financially_eligible',true,'contract_sha256','af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364','budget_basis','empirical_conservative_estimate','provider_quote',false,'blockers','[]'::jsonb);
 account:=(public.studio_puter_connect(w,actor,'fixture-token-only-not-real',observation)->>'account_id')::uuid;
 profile:=jsonb_build_object('version','puter-native-1.0.0','model','togetherai:wan-ai/wan2.7-i2v','contract_sha256','af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364','width',720,'height',1280,'output_fps',30,
  'native_voice_acknowledged',true,'voice_policy','provider_generated_review','example',jsonb_build_object('id',sample,'sha256',repeat('e',64)),
  'references',jsonb_build_array(jsonb_build_object('character_id','lia','sha256',repeat('b',64)),jsonb_build_object('character_id','rui','sha256',repeat('b',64))));
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256,legacy_identity) values(sid,w,profile,repeat('a',64),false);
 insert into public.studio_chapter_presentations values(sid,1,1,'cinematic_3d');
 insert into public.studio_chapter_productions values(sid,1,repeat('a',64));
 insert into public.studio_story_style_samples(id,workspace_id,sample,path,ready) values(sample,w,jsonb_build_object('id',sample,'sha256',repeat('e',64),'source','puter','style_id','cinematic_3d','review_scope','reviewed_sample','has_audio',true),w||'/story-samples/'||sample||'/'||repeat('e',64)||'.mp4',true);
 for i in 0..2 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat((i+1)::text,64),'remote_filename','content-ai-puter-'||repeat((i+1)::text,64)||'.mp4','phase','planned','remote_sha256',null,'remote_complete',false,'cleanup_done',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',fingerprint,'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),
  'draft',jsonb_build_object('summary','Lia e Rui encontram a chave e decidem procurar a porta da feira.','scenes',jsonb_build_array(
   jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Então vamos descobrir juntos!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')))),
  'provider','puter','reserved_at',now(),'account_sha256',repeat('c',64),'initial_remaining_credits',1000,'reserved_credits',990,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);
 insert into public.system_config(key,value) values('story_production','{"puter_chapter_enabled":true}') on conflict(key) do update set value=excluded.value;
 perform public.save_puter_draft(eid,repeat('a',64),fingerprint,run->'draft');
 begin perform public.studio_puter_action(w,outsider,eid,'resume');raise exception 'Foreign action accepted';exception when insufficient_privilege then null;end;
 perform pg_temp.native_assert(public.claim_puter_chapter(eid,account,token)->>'code'='claimed','claims protected account');
 perform pg_temp.native_assert(public.claim_puter_chapter(eid,account,other_token)->>'code'='account_busy','duplicate runner waits');
 perform public.observe_puter_chapter(eid,token,observation||'{"remaining_credits":677.7}');
 perform pg_temp.native_assert(public.reserve_puter_chapter(eid,token,account,run)->>'code'='complete_chapter_budget_required','short balance never reserves');
 perform public.observe_puter_chapter(eid,token,observation);
 begin perform public.reserve_puter_chapter(eid,token,account,jsonb_set(run,'{profile,output_fps}','24'));raise exception 'Wrong FPS accepted';exception when check_violation then null;end;
 perform pg_temp.native_assert(public.reserve_puter_chapter(eid,token,account,run)->>'code'='reserved','full chapter reserved');
 perform pg_temp.native_assert(public.reserve_puter_chapter(eid,token,account,run)->>'code'='existing','idempotent admission');
 perform pg_temp.native_assert(public.studio_puter_view(w,actor)#>>'{accounts,0,estimated_chapters}'='0','hold prevents double capacity');
 begin perform public.save_puter_chapter(eid,other_token,run);raise exception 'Foreign lease saved';exception when insufficient_privilege then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','1'),'{tasks,0,phase}','"submission_started"');
 perform public.save_puter_chapter(eid,token,changed);perform public.save_puter_chapter(eid,token,changed);run:=changed;
 perform pg_temp.native_assert(public.studio_puter_view(w,actor)#>>'{accounts,0,balance_fresh}'='false','submission invalidates old capacity');
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{tasks,0,phase}','"planned"');
 begin perform public.save_puter_chapter(eid,token,changed);raise exception 'Uncertain request reset';exception when check_violation then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{tasks,1,phase}','"submission_started"');
 begin perform public.save_puter_chapter(eid,token,changed);raise exception 'Parallel task accepted';exception when check_violation then null;end;
 changed:=jsonb_set(jsonb_set(run,'{revision}','2'),'{budget_reconciled}','true');
 begin perform public.save_puter_chapter(eid,token,changed);raise exception 'Uncertain budget released';exception when check_violation then null;end;
 update public.studio_puter_preparations set cancel_requested=true where episode_id=eid;
 perform pg_temp.native_assert(public.close_puter_chapter(eid,token)->>'code'='cancellation_pending','missing remote evidence retains hold');
 begin perform public.guard_puter_chapter(eid,token,true);raise exception 'Submission after cancellation';exception when check_violation then null;end;
 update public.studio_puter_preparations set cancel_requested=false where episode_id=eid;
 perform public.finish_puter_chapter(eid,token);
 perform pg_temp.native_assert((select held from public.studio_puter_runs where episode_id=eid),'lease release does not release hold');
 perform public.claim_puter_chapter(eid,account,other_token);
 begin perform public.guard_puter_chapter(eid,token);raise exception 'Old lease reused';exception when insufficient_privilege then null;end;
 for i in 0..2 loop
  if i>0 then run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"submission_started"');perform public.save_puter_chapter(eid,other_token,run);end if;
  run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"collecting"');
  run:=jsonb_set(jsonb_set(run,array['tasks',i::text,'remote_sha256'],to_jsonb(repeat((i+4)::text,64))),array['tasks',i::text,'remote_complete'],'true');perform public.save_puter_chapter(eid,other_token,run);
  clip:=jsonb_build_object('request_key',run#>>array['tasks',i::text,'request_key'],'sha256',repeat((i+4)::text,64),'frames',150,'path','episodes/'||eid||'/native/'||repeat((i+4)::text,64)||'.mp4');
  run:=jsonb_set(jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"ready"'),array['tasks',i::text,'clip'],clip);perform public.save_puter_chapter(eid,other_token,run);
  run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'cleanup_done'],'true');perform public.save_puter_chapter(eid,other_token,run);
  voice:=case when i=1 then 'rui' else 'lia' end;
  scene:=jsonb_build_object('id','take_'||i,'order',i,'narration_text',run#>>array['draft','scenes',i::text,'narration_text'],'story_visual',run#>array['draft','scenes',i::text,'visual'],
    'duration_seconds',5,'transition','cut','ken_burns','static','asset_landscape',null,
    'asset_portrait',jsonb_build_object('url','https://fixture.supabase.co/storage/v1/object/authenticated/studio-private/'||(clip->>'path')),
    'native_animation',jsonb_build_object('shot_id','take_'||i,'character_id',voice,'reference_sha256',repeat('b',64),'request_key',clip->>'request_key','video_sha256',clip->>'sha256','frames',150));
  scenes:=scenes||jsonb_build_array(scene);
  cuts:=cuts||jsonb_build_array(jsonb_build_object('speaker',voice,'source_sha256',clip->>'sha256','frames',150,'original_audio',true,'audio_transport',jsonb_build_object('silent_reference',false,'correlation',0.99,'measured_lag_seconds',0.001)));
 end loop;
 script:=jsonb_build_object('episode_id',eid,'prompt_version','3.0.0','fiction',jsonb_build_object('context',run->'context','summary',run#>'{draft,summary}',
  'native_animation',jsonb_build_object('version','1.0.0','provider','puter','profile_sha256',repeat('a',64),'width',720,'height',1280,'output_fps',30,'voice_identity_preserved',false,'speech_transcription_verified',false,'human_review_required',true)),
  'scenes',scenes,'gap_seconds',0,'music',null,'sources','[]'::jsonb,'disclosures',jsonb_build_object('contains_synthetic_media',true,'commercial_content',false));
 qa:=jsonb_build_object('episode_id',eid,'fingerprint',fingerprint,'sha256',repeat('e',64),'script_hash',repeat('f',64),'policy_hash',repeat('d',64),
  'quality_policy',(select value from public.system_config where key='fact_check'),'width',720,'height',1280,'encoded_fps',30,'frames',450,'seconds',15,'cuts',cuts,'all_decoded_frames_pixel_identical',true,'video_reencoded',false,
  'audio_encoded_once_from_native_pcm',true,'decode_verified',true,'human_review_required',true,'voice_continuity_approved',false,'production_ready',false,'script_qa',jsonb_build_object('passed',true));
 script_text:=script::text;qa_text:=qa::text;
 output:=jsonb_build_object('sha256',repeat('e',64),'bytes',100,'path','episodes/'||eid||'/native/'||repeat('e',64)||'.mp4',
  'script_sha256',encode(sha256(convert_to(script_text,'UTF8')),'hex'),'qa_sha256',encode(sha256(convert_to(qa_text,'UTF8')),'hex'));
 output:=output||jsonb_build_object('script_path','episodes/'||eid||'/native/'||(output->>'script_sha256')||'.json','qa_path','episodes/'||eid||'/native/'||(output->>'qa_sha256')||'.json');
 run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),'{output}',output);perform public.save_puter_chapter(eid,other_token,run);
 run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),'{budget_reconciled}','true');perform public.save_puter_chapter(eid,other_token,run);
 begin perform public.complete_puter_chapter(eid,other_token,'https://fixture.supabase.co',script_text||' ',qa_text);raise exception 'Changed script bytes accepted';exception when check_violation then null;end;
 begin perform public.complete_puter_chapter(eid,other_token,'https://fixture.supabase.co',script_text,(qa||'{"video_reencoded":true}')::text);raise exception 'Changed QA accepted';exception when check_violation then null;end;
 perform pg_temp.native_assert(public.complete_puter_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','native output mounted using measured non-integer frame duration');
 perform pg_temp.native_assert(public.complete_puter_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','mount is idempotent');
 update public.system_config set value=value||'{"require_source_per_claim":false}' where key='fact_check';
 begin perform public.complete_puter_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text);raise exception 'Obsolete quality policy accepted';exception when check_violation then null;end;
 update public.system_config set value=qa->'quality_policy' where key='fact_check';
 perform pg_temp.native_assert((select status='rendered' and approval_date is null and render_url like '%/authenticated/studio-private/episodes/%' from public.episodes where id=eid),'native movie stays private and awaits review');
 perform pg_temp.native_assert((select not held from public.studio_puter_runs where episode_id=eid),'only full output reconciles hold');
 perform pg_temp.native_assert(not has_table_privilege('authenticated','public.studio_puter_runs','select'),'private checkpoints hidden');
 perform pg_temp.native_assert(not has_function_privilege('authenticated','public.claim_puter_chapter(uuid,uuid,uuid)','execute'),'browser cannot claim credential');
 perform pg_temp.native_assert(not has_function_privilege('anon','public.complete_puter_chapter(uuid,uuid,text,text,text)','execute'),'browser cannot forge completion');
 perform public.finish_puter_chapter(eid,other_token);
end $$;
rollback;
