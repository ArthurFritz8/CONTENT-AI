\set ON_ERROR_STOP on
begin;
create function pg_temp.native_panel_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Native panel assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;sid uuid;request uuid:=gen_random_uuid();wallet uuid;sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();token uuid:=gen_random_uuid();pref jsonb;bib jsonb;profile jsonb;r jsonb;refs jsonb:='[]';directions jsonb:='[]';c jsonb;mid uuid;idx int:=0;iid uuid;eid uuid;draft jsonb;run jsonb;duration_req uuid:=gen_random_uuid();frozen jsonb;tasks jsonb:='[]';proof jsonb;changed jsonb;new_eid uuid;repair_req uuid;edit jsonb;new_draft jsonb;reuse jsonb;source_run jsonb;source_eid uuid;
begin
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":false,"animated_preparation_enabled":false}') on conflict(key) do update set value=excluded.value;
 w:=public.studio_provision(actor,'Native panel integration',false);
 update public.studio_workspaces set settings=jsonb_set(settings,'{pipeline}','{"max_episodes_per_day":3}') where id=w;
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 perform public.studio_story_claim(w,actor,request,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref,'native_shots',6));sid:=public.studio_story_save(w,actor,request,bib);
 for c in select value from jsonb_array_elements(bib->'cast') loop
  idx:=idx+1;mid:=gen_random_uuid();r:=public.studio_production_media_reserve(w,actor,sid,mid,c->>'id','reference',repeat(idx::text,64),500,'{"mime":"image/png","width":704,"height":1280}');perform public.studio_production_media_ready(w,actor,mid,repeat(idx::text,64));
  refs:=refs||jsonb_build_array(jsonb_build_object('character_id',c->>'id','path',r->>'path','sha256',repeat(idx::text,64)));
  directions:=directions||jsonb_build_array(jsonb_build_object('character_id',c->>'id','description','Voz adulta em português brasileiro, clara, expressiva e natural.'));
 end loop;
 r:=public.register_story_style_sample(w,jsonb_build_object('id',sample,'style_id','cinematic_3d','source','auray','title','Exemplo nativo de integração','model','MiniMax H3','sha256',repeat('e',64),'bytes',1000,'seconds',15.5,'width',768,'height',1344,'output_fps',24,'native_fps',24,'has_audio',true,'motion','generated','review_scope','reviewed_sample','limitations',jsonb_build_array('A identidade da voz pode variar.')));
 perform public.ready_story_style_sample(w,sample,repeat('e',64));
 profile:=jsonb_build_object('version','auray-native-1.0.0','model','auray-ai/minimax-h3/text-to-video','contract_sha256','365a74a0aeab67eebf117fd826d540017748d687ba0955fc8ed989d113a816f1','style','Animação 3D com expressões legíveis, gestos naturais e a roupa das referências.','orientation','portrait','width',768,'height',1344,'output_fps',24,'references',refs,'voice_directions',directions,'voice_policy','provider_generated_review','native_voice_acknowledged',true,'example',jsonb_build_object('id',sample,'sha256',repeat('e',64)));
 perform pg_temp.native_panel_assert((public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->>'can_configure')::boolean,'native setup accepts images without Edge voice samples');
 perform pg_temp.native_panel_assert(jsonb_array_length(public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->'native_examples')=1,'matching private example visible');
 begin perform public.studio_native_pattern_finalize(w,outsider,sid,1,'cinematic_3d',profile,repeat('a',64));raise exception 'Outsider fixed native profile';exception when insufficient_privilege then null;end;
 begin perform public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{native_voice_acknowledged}','false'),repeat('a',64));raise exception 'Missing voice acknowledgement accepted';exception when check_violation then null;end;
 begin perform public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{example,id}',to_jsonb(gen_random_uuid())),repeat('a',64));raise exception 'Unreviewed example accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern saved');
 perform pg_temp.native_panel_assert(public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern save idempotent');
 perform pg_temp.native_panel_assert(public.studio_story_next(w,actor,sid)->>'code'='native_setup_required','saving profile does not activate generation');
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":true,"animated_preparation_enabled":false}') on conflict(key) do update set value=excluded.value;
 wallet:=public.register_auray_monitor(w,encode(sha256(convert_to('{"account":'||to_jsonb(account)::text||',"provider":"auray"}','UTF8')),'hex'),'[]');
 perform pg_temp.native_panel_assert((select native_shots=6 from public.studio_series where id=sid),'proposal duration saved');
 begin perform public.studio_story_duration_save(w,outsider,sid,duration_req,0,3);raise exception 'Outsider changed duration';exception when insufficient_privilege then null;end;
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,duration_req,0,6)->>'code'='saved','explicit selection uses independent CAS');
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,duration_req,0,6)->>'revision'='1','format request idempotent');
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,gen_random_uuid(),0,3)->>'code'='revision_changed','stale setting rejected');
 r:=public.studio_story_next(w,actor,sid);iid:=(r->>'idea_id')::uuid;perform pg_temp.native_panel_assert(r->>'code'='queued','native chapter admission independent of Modal gate');
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 draft:=jsonb_build_object('title','O segredo da chave','summary','Lia e Rui encontram a chave e procuram uma pista para descobrir o segredo da feira.','scenes',jsonb_build_array(
  jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised'),'prompt','Medium close-up, the reference character raises one hand and speaks naturally.','seed',1),
  jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','sad'),'prompt','Close-up, the reference character speaks with a quiet gesture and clear eyes.','seed',2),
  jsonb_build_object('narration_text','Vamos descobrir esse segredo!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','happy'),'prompt','Medium shot, the reference character smiles and speaks with one clear gesture.','seed',3)));
 select jsonb_set(draft,'{scenes}',jsonb_agg(draft->'scenes'->(g.value%3) order by g.value)) into draft from generate_series(0,5) g(value);
 frozen:=(select briefing->'story_context' from public.episodes where id=eid);
 perform pg_temp.native_panel_assert(public.native_chapter_shots(frozen)=6,'queued duration snapshotted');
 perform public.studio_story_duration_save(w,actor,sid,gen_random_uuid(),1,3);
 perform pg_temp.native_panel_assert((select briefing->'story_context'=frozen from public.episodes where id=eid),'new preference cannot rewrite frozen episode');
 begin perform public.save_native_draft(eid,repeat('a',64),repeat('d',64),jsonb_set(draft,'{scenes}',jsonb_path_query_array(draft,'$.scenes[0 to 2]')));raise exception 'Short draft accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer saves frozen draft');
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer never replaces saved draft');
 perform pg_temp.native_panel_assert(public.native_worker_input(eid)->>'code'='prepare','worker receives the frozen plan and connected wallet');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='dispatch','pipeline dispatches native workflow');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='waiting_for_runner','duplicate ticks do not duplicate dispatch');
 for idx in 0..5 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat(md5(idx::text),2),'job_id','video_'||repeat(md5(idx::text),2),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',repeat('d',64),'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),'draft',draft,'reserved_at',now(),'account_id',account,'key_id','fixture','period',to_char(now() at time zone 'UTC','YYYY-MM'),'contract_sha256',profile->>'contract_sha256','initial_plan_remaining',50,'initial_key_remaining',50,'reserved_credits',30,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);

 perform public.reserve_native_chapter(eid,wallet,run);
 source_eid:=eid;
 tasks:='[]';
 for idx in 0..5 loop
  tasks:=tasks||jsonb_build_array((run->'tasks'->idx)||jsonb_build_object('phase','ready','charged_credits',5,'settled',true,'clip',jsonb_build_object('request_key',repeat(md5(idx::text),2),'sha256',repeat(md5((idx+4)::text),2),'frames',120,'path','episodes/'||eid||'/native/'||repeat(md5((idx+4)::text),2)||'.mp4')));
 end loop;
 source_run:=run||jsonb_build_object('tasks',tasks,'output',jsonb_build_object('sha256',repeat('f',64)),'budget_reconciled',true);
 update public.studio_native_runs set state=source_run,held=false where episode_id=eid;
 update public.episodes set status='script',script_json=jsonb_build_object('fiction',jsonb_build_object('context',briefing->'story_context','summary',draft->>'summary'),'disclosures',jsonb_build_object('contains_synthetic_media',true,'commercial_content',false)) where id=eid;
 update public.episodes set status='assets' where id=eid;
 update public.episodes set status='rendered',render_url='https://example.test/repair.mp4' where id=eid;
 update public.episodes set status='review' where id=eid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_view(w,actor,eid)->>'can_repair'='true','last reconciled native chapter can be corrected');
 edit:=jsonb_build_object('index',1,'dialogue',draft#>>'{scenes,1,narration_text}','prompt','Close-up, one careful shoulder gesture and a clear emotional reaction.','summary',draft->>'summary');
 new_draft:=jsonb_set(jsonb_set(draft,'{scenes,1,prompt}',edit->'prompt'),'{scenes,1,seed}','3');
 repair_req:=gen_random_uuid();
 perform pg_temp.native_panel_assert(public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64))->>'code'='repair_budget_required','zero or stale budget preserves original and makes no attempt');
 perform public.claim_auray_sync(wallet,token);
 perform public.observe_auray_monitor(wallet,token,jsonb_build_object('checked_at',now(),'period',to_char(now() at time zone 'UTC','YYYY-MM'),'plan_remaining',5,'key_remaining',5,'monthly_allowance',50,'blockers','[]'::jsonb,'production_ready',false));
 perform public.finish_auray_sync(wallet,token,true);
 r:=public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64));
 perform pg_temp.native_panel_assert(r->>'code'='started','five credits admit one replacement');new_eid:=(r->>'episode_id')::uuid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64))->>'episode_id'=new_eid::text,'retry returns same repair episode');
 perform pg_temp.native_panel_assert((select status='review' and render_url='https://example.test/repair.mp4' from public.episodes where id=eid),'original output retained');
 update public.episodes set status='research' where id=new_eid;
 r:=public.native_worker_input(new_eid);
 perform pg_temp.native_panel_assert(r->>'code'='prepare' and jsonb_array_length(r->'reuse')=5,'worker receives 5 verified original clips');
 tasks:='[]';
 for idx in 0..5 loop
  c:=jsonb_build_object('request_key',repeat(md5((idx+7)::text),2),'job_id','video_'||repeat(md5((idx+7)::text),2),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null);
  if idx<>1 then
   reuse:=jsonb_build_object('index',idx,'episode_id',eid,'clip',source_run->'tasks'->idx->'clip');
   c:=c||jsonb_build_object('reused',reuse,'phase','ready','settled',true,'clip',(reuse->'clip')||jsonb_build_object('request_key',c->>'request_key','path','episodes/'||new_eid||'/native/'||(reuse#>>'{clip,sha256}')||'.mp4'));
  end if;
  tasks:=tasks||jsonb_build_array(c);
 end loop;
 run:=run||jsonb_build_object('episode_id',new_eid,'draft',new_draft,'fingerprint',repeat('9',64),'reserved_credits',5,'initial_plan_remaining',5,'initial_key_remaining',5,'tasks',tasks);
 begin perform public.reserve_native_chapter(new_eid,wallet,jsonb_set(run,'{tasks,0,reused,clip,sha256}',to_jsonb(repeat('f',64))));raise exception 'Forged reusable clip accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.reserve_native_chapter(new_eid,wallet,run)->>'code'='reserved','one-shot reservation accepted with original provenance');
 perform pg_temp.native_panel_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,native_reserved_credits}')::int=5,'panel holds five, not fifteen');
 perform public.claim_native_chapter(new_eid,token);
 changed:=jsonb_set(jsonb_set(run,'{revision}','1'),'{tasks,1,phase}','"submission_started"');
 perform public.save_native_chapter(new_eid,token,changed);
 perform pg_temp.native_panel_assert(public.studio_native_repair_restore(w,actor,new_eid)->>'code'='repair_locked','cannot restore with possible charges');
 -- A closed uncharged refusal can restore the original without erasing either attempt.
 update public.studio_native_runs set closed_at=now(),held=false where episode_id=new_eid;
 update public.episodes set status='failed',failure_reason='fixture_cancelled' where id=new_eid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_restore(w,actor,new_eid)->>'code'='restored','restore retains safe original');
 perform pg_temp.native_panel_assert((select idea_id=iid from public.studio_story_chapters where series_id=sid and chapter_number=1),'restored original chapter pointer');
 perform pg_temp.native_panel_assert(not exists(select 1 from public.studio_outbox where workspace_id=w),'repair never publishes');
end $$;

do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;sid uuid;request uuid:=gen_random_uuid();wallet uuid;sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();token uuid:=gen_random_uuid();pref jsonb;bib jsonb;profile jsonb;r jsonb;refs jsonb:='[]';directions jsonb:='[]';c jsonb;mid uuid;idx int:=0;iid uuid;eid uuid;draft jsonb;run jsonb;duration_req uuid:=gen_random_uuid();frozen jsonb;tasks jsonb:='[]';proof jsonb;changed jsonb;new_eid uuid;repair_req uuid;edit jsonb;new_draft jsonb;reuse jsonb;source_run jsonb;source_eid uuid;
begin
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":false,"animated_preparation_enabled":false}') on conflict(key) do update set value=excluded.value;
 w:=public.studio_provision(actor,'Native panel integration',false);
 update public.studio_workspaces set settings=jsonb_set(settings,'{pipeline}','{"max_episodes_per_day":3}') where id=w;
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 perform public.studio_story_claim(w,actor,request,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref,'native_shots',9));sid:=public.studio_story_save(w,actor,request,bib);
 for c in select value from jsonb_array_elements(bib->'cast') loop
  idx:=idx+1;mid:=gen_random_uuid();r:=public.studio_production_media_reserve(w,actor,sid,mid,c->>'id','reference',repeat(idx::text,64),500,'{"mime":"image/png","width":704,"height":1280}');perform public.studio_production_media_ready(w,actor,mid,repeat(idx::text,64));
  refs:=refs||jsonb_build_array(jsonb_build_object('character_id',c->>'id','path',r->>'path','sha256',repeat(idx::text,64)));
  directions:=directions||jsonb_build_array(jsonb_build_object('character_id',c->>'id','description','Voz adulta em português brasileiro, clara, expressiva e natural.'));
 end loop;
 r:=public.register_story_style_sample(w,jsonb_build_object('id',sample,'style_id','cinematic_3d','source','auray','title','Exemplo nativo de integração','model','MiniMax H3','sha256',repeat('e',64),'bytes',1000,'seconds',15.5,'width',768,'height',1344,'output_fps',24,'native_fps',24,'has_audio',true,'motion','generated','review_scope','reviewed_sample','limitations',jsonb_build_array('A identidade da voz pode variar.')));
 perform public.ready_story_style_sample(w,sample,repeat('e',64));
 profile:=jsonb_build_object('version','auray-native-1.0.0','model','auray-ai/minimax-h3/text-to-video','contract_sha256','365a74a0aeab67eebf117fd826d540017748d687ba0955fc8ed989d113a816f1','style','Animação 3D com expressões legíveis, gestos naturais e a roupa das referências.','orientation','portrait','width',768,'height',1344,'output_fps',24,'references',refs,'voice_directions',directions,'voice_policy','provider_generated_review','native_voice_acknowledged',true,'example',jsonb_build_object('id',sample,'sha256',repeat('e',64)));
 perform pg_temp.native_panel_assert((public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->>'can_configure')::boolean,'native setup accepts images without Edge voice samples');
 perform pg_temp.native_panel_assert(jsonb_array_length(public.studio_story_pattern_view(w,actor,sid,1,'cinematic_3d')->'native_examples')=1,'matching private example visible');
 begin perform public.studio_native_pattern_finalize(w,outsider,sid,1,'cinematic_3d',profile,repeat('a',64));raise exception 'Outsider fixed native profile';exception when insufficient_privilege then null;end;
 begin perform public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{native_voice_acknowledged}','false'),repeat('a',64));raise exception 'Missing voice acknowledgement accepted';exception when check_violation then null;end;
 begin perform public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',jsonb_set(profile,'{example,id}',to_jsonb(gen_random_uuid())),repeat('a',64));raise exception 'Unreviewed example accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern saved');
 perform pg_temp.native_panel_assert(public.studio_native_pattern_finalize(w,actor,sid,1,'cinematic_3d',profile,repeat('a',64))->>'code'='saved','native pattern save idempotent');
 perform pg_temp.native_panel_assert(public.studio_story_next(w,actor,sid)->>'code'='native_setup_required','saving profile does not activate generation');
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":true,"animated_preparation_enabled":false}') on conflict(key) do update set value=excluded.value;
 wallet:=public.register_auray_monitor(w,encode(sha256(convert_to('{"account":'||to_jsonb(account)::text||',"provider":"auray"}','UTF8')),'hex'),'[]');
 perform pg_temp.native_panel_assert((select native_shots=9 from public.studio_series where id=sid),'proposal duration saved');
 begin perform public.studio_story_duration_save(w,outsider,sid,duration_req,0,3);raise exception 'Outsider changed duration';exception when insufficient_privilege then null;end;
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,duration_req,0,9)->>'code'='saved','explicit selection uses independent CAS');
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,duration_req,0,9)->>'revision'='1','format request idempotent');
 perform pg_temp.native_panel_assert(public.studio_story_duration_save(w,actor,sid,gen_random_uuid(),0,3)->>'code'='revision_changed','stale setting rejected');
 r:=public.studio_story_next(w,actor,sid);iid:=(r->>'idea_id')::uuid;perform pg_temp.native_panel_assert(r->>'code'='queued','native chapter admission independent of Modal gate');
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 draft:=jsonb_build_object('title','O segredo da chave','summary','Lia e Rui encontram a chave e procuram uma pista para descobrir o segredo da feira.','scenes',jsonb_build_array(
  jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised'),'prompt','Medium close-up, the reference character raises one hand and speaks naturally.','seed',1),
  jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','sad'),'prompt','Close-up, the reference character speaks with a quiet gesture and clear eyes.','seed',2),
  jsonb_build_object('narration_text','Vamos descobrir esse segredo!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','happy'),'prompt','Medium shot, the reference character smiles and speaks with one clear gesture.','seed',3)));
 select jsonb_set(draft,'{scenes}',jsonb_agg(draft->'scenes'->(g.value%3) order by g.value)) into draft from generate_series(0,8) g(value);
 frozen:=(select briefing->'story_context' from public.episodes where id=eid);
 perform pg_temp.native_panel_assert(public.native_chapter_shots(frozen)=9,'queued duration snapshotted');
 perform public.studio_story_duration_save(w,actor,sid,gen_random_uuid(),1,3);
 perform pg_temp.native_panel_assert((select briefing->'story_context'=frozen from public.episodes where id=eid),'new preference cannot rewrite frozen episode');
 begin perform public.save_native_draft(eid,repeat('a',64),repeat('d',64),jsonb_set(draft,'{scenes}',jsonb_path_query_array(draft,'$.scenes[0 to 2]')));raise exception 'Short draft accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer saves frozen draft');
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer never replaces saved draft');
 perform pg_temp.native_panel_assert(public.native_worker_input(eid)->>'code'='prepare','worker receives the frozen plan and connected wallet');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='dispatch','pipeline dispatches native workflow');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='waiting_for_runner','duplicate ticks do not duplicate dispatch');
 for idx in 0..8 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat(md5(idx::text),2),'job_id','video_'||repeat(md5(idx::text),2),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',repeat('d',64),'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),'draft',draft,'reserved_at',now(),'account_id',account,'key_id','fixture','period',to_char(now() at time zone 'UTC','YYYY-MM'),'contract_sha256',profile->>'contract_sha256','initial_plan_remaining',50,'initial_key_remaining',50,'reserved_credits',45,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);

 perform public.reserve_native_chapter(eid,wallet,run);
 source_eid:=eid;
 tasks:='[]';
 for idx in 0..8 loop
  tasks:=tasks||jsonb_build_array((run->'tasks'->idx)||jsonb_build_object('phase','ready','charged_credits',5,'settled',true,'clip',jsonb_build_object('request_key',repeat(md5(idx::text),2),'sha256',repeat(md5((idx+4)::text),2),'frames',120,'path','episodes/'||eid||'/native/'||repeat(md5((idx+4)::text),2)||'.mp4')));
 end loop;
 source_run:=run||jsonb_build_object('tasks',tasks,'output',jsonb_build_object('sha256',repeat('f',64)),'budget_reconciled',true);
 update public.studio_native_runs set state=source_run,held=false where episode_id=eid;
 update public.episodes set status='script',script_json=jsonb_build_object('fiction',jsonb_build_object('context',briefing->'story_context','summary',draft->>'summary'),'disclosures',jsonb_build_object('contains_synthetic_media',true,'commercial_content',false)) where id=eid;
 update public.episodes set status='assets' where id=eid;
 update public.episodes set status='rendered',render_url='https://example.test/repair.mp4' where id=eid;
 update public.episodes set status='review' where id=eid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_view(w,actor,eid)->>'can_repair'='true','last reconciled native chapter can be corrected');
 edit:=jsonb_build_object('index',1,'dialogue',draft#>>'{scenes,1,narration_text}','prompt','Close-up, one careful shoulder gesture and a clear emotional reaction.','summary',draft->>'summary');
 new_draft:=jsonb_set(jsonb_set(draft,'{scenes,1,prompt}',edit->'prompt'),'{scenes,1,seed}','3');
 repair_req:=gen_random_uuid();
 perform pg_temp.native_panel_assert(public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64))->>'code'='repair_budget_required','zero or stale budget preserves original and makes no attempt');
 perform public.claim_auray_sync(wallet,token);
 perform public.observe_auray_monitor(wallet,token,jsonb_build_object('checked_at',now(),'period',to_char(now() at time zone 'UTC','YYYY-MM'),'plan_remaining',5,'key_remaining',5,'monthly_allowance',50,'blockers','[]'::jsonb,'production_ready',false));
 perform public.finish_auray_sync(wallet,token,true);
 r:=public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64));
 perform pg_temp.native_panel_assert(r->>'code'='started','five credits admit one replacement');new_eid:=(r->>'episode_id')::uuid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_prepare(w,actor,eid,repair_req,edit,new_draft,repeat('9',64))->>'episode_id'=new_eid::text,'retry returns same repair episode');
 perform pg_temp.native_panel_assert((select status='review' and render_url='https://example.test/repair.mp4' from public.episodes where id=eid),'original output retained');
 update public.episodes set status='research' where id=new_eid;
 r:=public.native_worker_input(new_eid);
 perform pg_temp.native_panel_assert(r->>'code'='prepare' and jsonb_array_length(r->'reuse')=8,'worker receives 8 verified original clips');
 tasks:='[]';
 for idx in 0..8 loop
  c:=jsonb_build_object('request_key',repeat(md5((idx+7)::text),2),'job_id','video_'||repeat(md5((idx+7)::text),2),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null);
  if idx<>1 then
   reuse:=jsonb_build_object('index',idx,'episode_id',eid,'clip',source_run->'tasks'->idx->'clip');
   c:=c||jsonb_build_object('reused',reuse,'phase','ready','settled',true,'clip',(reuse->'clip')||jsonb_build_object('request_key',c->>'request_key','path','episodes/'||new_eid||'/native/'||(reuse#>>'{clip,sha256}')||'.mp4'));
  end if;
  tasks:=tasks||jsonb_build_array(c);
 end loop;
 run:=run||jsonb_build_object('episode_id',new_eid,'draft',new_draft,'fingerprint',repeat('9',64),'reserved_credits',5,'initial_plan_remaining',5,'initial_key_remaining',5,'tasks',tasks);
 begin perform public.reserve_native_chapter(new_eid,wallet,jsonb_set(run,'{tasks,0,reused,clip,sha256}',to_jsonb(repeat('f',64))));raise exception 'Forged reusable clip accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.reserve_native_chapter(new_eid,wallet,run)->>'code'='reserved','one-shot reservation accepted with original provenance');
 perform pg_temp.native_panel_assert((public.studio_video_overview(w,actor)#>>'{wallets,0,native_reserved_credits}')::int=5,'panel holds five, not fifteen');
 perform public.claim_native_chapter(new_eid,token);
 changed:=jsonb_set(jsonb_set(run,'{revision}','1'),'{tasks,1,phase}','"submission_started"');
 perform public.save_native_chapter(new_eid,token,changed);
 perform pg_temp.native_panel_assert(public.studio_native_repair_restore(w,actor,new_eid)->>'code'='repair_locked','cannot restore with possible charges');
 -- A closed uncharged refusal can restore the original without erasing either attempt.
 update public.studio_native_runs set closed_at=now(),held=false where episode_id=new_eid;
 update public.episodes set status='failed',failure_reason='fixture_cancelled' where id=new_eid;
 perform pg_temp.native_panel_assert(public.studio_native_repair_restore(w,actor,new_eid)->>'code'='restored','restore retains safe original');
 perform pg_temp.native_panel_assert((select idea_id=iid from public.studio_story_chapters where series_id=sid and chapter_number=1),'restored original chapter pointer');
 perform pg_temp.native_panel_assert(not exists(select 1 from public.studio_outbox where workspace_id=w),'repair never publishes');
end $$;

do $$
declare actor uuid:=gen_random_uuid();w uuid;wallet uuid;sid uuid;req uuid:=gen_random_uuid();r jsonb;bib jsonb;pref jsonb;profile jsonb;run jsonb;changed jsonb;tasks jsonb:='[]';
 iid uuid;eid uuid;token uuid:=gen_random_uuid();other_token uuid:=gen_random_uuid();sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();fingerprint text:=repeat('f',64);i int;script jsonb;qa jsonb;scene jsonb;scenes jsonb:='[]';cuts jsonb:='[]';clip jsonb;script_text text;qa_text text;output jsonb;voice text;
begin
 update public.system_config set value='{"native_chapter_enabled":false}' where key='story_production';
 w:=public.studio_provision(actor,'Native executor test',false);
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 perform public.studio_story_claim(w,actor,req,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref,'native_shots',9));
 sid:=public.studio_story_save(w,actor,req,bib);
 -- Seed the future, reviewed native binding as an operator. Ordinary admission
 -- remains closed: the panel cannot call this legacy narrative helper.
 r:=public.studio_story_next_illustrated(w,actor,sid);iid:=(r->>'idea_id')::uuid;
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 wallet:=public.register_auray_monitor(w,encode(sha256(convert_to('{"account":'||to_jsonb(account)::text||',"provider":"auray"}','UTF8')),'hex'),'[]');
 update public.studio_video_wallets set remaining_units=50,checked_at=now(),valid_until=now()+interval '5 minutes' where id=wallet;
 profile:=jsonb_build_object('version','auray-native-1.0.0','model','auray-ai/minimax-h3/text-to-video','contract_sha256',repeat('d',64),
  'native_voice_acknowledged',true,'voice_policy','provider_generated_review','example',jsonb_build_object('id',sample,'sha256',repeat('e',64)),
  'references',jsonb_build_array(jsonb_build_object('character_id','lia','sha256',repeat('b',64)),jsonb_build_object('character_id','rui','sha256',repeat('b',64))));
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256,legacy_identity) values(sid,w,profile,repeat('a',64),false);
 insert into public.studio_chapter_presentations values(sid,1,1,'cinematic_3d');
 insert into public.studio_chapter_productions values(sid,1,repeat('a',64));
 insert into public.studio_story_style_samples(id,workspace_id,sample,path,ready) values(sample,w,jsonb_build_object('id',sample,'sha256',repeat('e',64),'source','auray','style_id','cinematic_3d','review_scope','reviewed_sample'),w||'/story-samples/'||sample||'/'||repeat('e',64)||'.mp4',true);
 for i in 0..8 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat(md5(i::text),2),'job_id','video_'||repeat(md5(i::text),2),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',fingerprint,'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),
  'draft',jsonb_build_object('summary','Lia e Rui encontram a chave e decidem procurar a porta da feira.','scenes',jsonb_build_array(
   jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','surprised')),
   jsonb_build_object('narration_text','Então vamos descobrir juntos!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised')))),
  'reserved_at',now(),'account_id',account,'key_id','fixture','period',to_char(now() at time zone 'UTC','YYYY-MM'),'contract_sha256',repeat('d',64),
  'initial_plan_remaining',50,'initial_key_remaining',50,'reserved_credits',45,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);
 select jsonb_set(run,'{draft,scenes}',jsonb_agg(run#>array['draft','scenes',(g.value%3)::text] order by g.value)) into run from generate_series(0,8) g(value);
 perform pg_temp.native_panel_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='native_setup_required','migration does not enable generation');
 insert into public.system_config(key,value) values('story_production','{"native_chapter_enabled":true}') on conflict(key) do update set value=excluded.value;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{initial_key_remaining}','44'));raise exception 'Incomplete chapter budget accepted';exception when check_violation then null;end;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{account_id}',to_jsonb(gen_random_uuid())));raise exception 'Wrong physical account accepted';exception when check_violation then null;end;
 begin perform public.reserve_native_chapter(eid,wallet,jsonb_set(run,'{profile,native_voice_acknowledged}','false'));raise exception 'Unacknowledged voices accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='reserved','full chapter reserve accepted');
 perform pg_temp.native_panel_assert(public.reserve_native_chapter(eid,wallet,run)->>'code'='existing','duplicate admission reuses chapter');
 perform pg_temp.native_panel_assert((select count(*)=1 from public.studio_native_runs where wallet_id=wallet and held),'one complete chapter hold');
 r:=public.studio_video_overview(w,actor);
 perform pg_temp.native_panel_assert(r#>>'{wallets,0,reserved_units}'='45','native reservation visible separately from raw provider balance');
 perform pg_temp.native_panel_assert(position('account_id' in r::text)=0 and position('key_id' in r::text)=0,'wallet overview never discloses native account credentials');
 perform pg_temp.native_panel_assert(public.claim_native_chapter(eid,token)->>'code'='claimed','native worker claims shared account');
 perform pg_temp.native_panel_assert(public.claim_auray_sync(wallet,other_token)->>'code'='waiting','monitor cannot take the active generator lease');
 perform pg_temp.native_panel_assert(public.claim_native_chapter(eid,other_token)->>'code'='waiting','duplicate native worker waits');
 begin perform public.save_native_chapter(eid,other_token,run);raise exception 'Stale worker saved';exception when insufficient_privilege then null;end;
 changed:=jsonb_set(run,'{revision}','1');changed:=jsonb_set(changed,'{tasks,0,phase}','"submission_started"');
 perform public.save_native_chapter(eid,token,changed);perform public.save_native_chapter(eid,token,changed);run:=changed;
 perform pg_temp.native_panel_assert(public.studio_video_overview(w,actor)#>>'{wallets,0,balance_fresh}'='false','accepted or uncertain charge invalidates old balance without erasing history');
 perform pg_temp.native_panel_assert((select remaining_units=50 from public.studio_video_wallets where id=wallet),'historical amount preserved until real refresh');
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
 perform pg_temp.native_panel_assert((select held from public.studio_native_runs where episode_id=eid),'releasing lease never releases reserved credits');
 perform public.claim_auray_sync(wallet,other_token);
 begin perform public.finish_native_chapter(eid,token);raise exception 'Old native worker cleared monitor lease';exception when insufficient_privilege then null;end;
 perform public.finish_auray_sync(wallet,other_token,true);
 perform public.claim_native_chapter(eid,other_token);
 begin perform public.guard_native_chapter(eid,token);raise exception 'Expired native token reused';exception when insufficient_privilege then null;end;
 -- Complete the exact same three jobs; no episode transition happens until the
 -- private script and assembly receipt match the immutable stored byte hashes.
 for i in 0..8 loop
  if i>0 then run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"submission_started"');perform public.save_native_chapter(eid,other_token,run);end if;
  run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"waiting"');
  run:=jsonb_set(jsonb_set(run,array['tasks',i::text,'charged_credits'],'5'),array['tasks',i::text,'settled'],'true');perform public.save_native_chapter(eid,other_token,run);
  clip:=jsonb_build_object('request_key',run#>>array['tasks',i::text,'request_key'],'sha256',repeat(md5((i+4)::text),2),'frames',124,'path','episodes/'||eid||'/native/'||repeat(md5((i+4)::text),2)||'.mp4');
  run:=jsonb_set(jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),array['tasks',i::text,'phase'],'"ready"'),array['tasks',i::text,'clip'],clip);perform public.save_native_chapter(eid,other_token,run);
  voice:=case when i%3=1 then 'rui' else 'lia' end;
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
  'quality_policy',(select value from public.system_config where key='fact_check'),'width',768,'height',1344,'encoded_fps',24,'frames',1116,'seconds',46.5,'cuts',cuts,'all_decoded_frames_pixel_identical',true,'video_reencoded',false,
  'audio_encoded_once_from_native_pcm',true,'decode_verified',true,'human_review_required',true,'voice_continuity_approved',false,'production_ready',false,'script_qa',jsonb_build_object('passed',true));
 script_text:=script::text;qa_text:=qa::text;
 output:=jsonb_build_object('sha256',repeat('e',64),'bytes',100,'path','episodes/'||eid||'/native/'||repeat('e',64)||'.mp4',
  'script_sha256',encode(sha256(convert_to(script_text,'UTF8')),'hex'),'qa_sha256',encode(sha256(convert_to(qa_text,'UTF8')),'hex'));
 output:=output||jsonb_build_object('script_path','episodes/'||eid||'/native/'||(output->>'script_sha256')||'.json','qa_path','episodes/'||eid||'/native/'||(output->>'qa_sha256')||'.json');
 run:=jsonb_set(jsonb_set(run,'{revision}',to_jsonb((run->>'revision')::int+1)),'{output}',output);perform public.save_native_chapter(eid,other_token,run);
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text||' ',qa_text);raise exception 'Changed script bytes accepted';exception when check_violation then null;end;
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,(qa||'{"video_reencoded":true}')::text);raise exception 'Changed QA accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','native output mounted using measured non-integer frame duration');
 perform pg_temp.native_panel_assert(public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text)->>'code'='saved','mount is idempotent');
 update public.system_config set value=value||'{"require_source_per_claim":false}' where key='fact_check';
 begin perform public.complete_native_chapter(eid,other_token,'https://fixture.supabase.co',script_text,qa_text);raise exception 'Obsolete quality policy accepted';exception when check_violation then null;end;
 update public.system_config set value=qa->'quality_policy' where key='fact_check';
 perform pg_temp.native_panel_assert((select status='rendered' and approval_date is null and render_url like '%/authenticated/studio-private/episodes/%' from public.episodes where id=eid),'native movie stays private and awaits review');
 r:='[]';
 for i in 0..8 loop r:=r||jsonb_build_array(jsonb_build_object('index',i,'speaker',run#>>array['draft','scenes',i::text,'visual','speaker_id'],'sha256',run#>>array['tasks',i::text,'clip','sha256'],
  'expected_text',run#>>array['draft','scenes',i::text,'narration_text'],'recognized_text','Fala que precisa ser conferida.','speech_status','possible_extra_speech','appearance_status','possible_color_shift','sampled_frames',6,'color_shift_score',0.6));end loop;
 changed:=jsonb_build_object('version','native-media-review-v1','episode_id',eid,'video_sha256',repeat('e',64),'created_at',now(),'speech_engine','faster-whisper-base-cpu',
  'model_revision','ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66','human_review_required',true,'lip_sync_verified',false,'identity_verified',false,'source_video_unchanged',true,'takes',r);
 begin perform public.save_native_media_review(eid,jsonb_set(changed,'{video_sha256}',to_jsonb(repeat('a',64))));raise exception 'Review for another film accepted';exception when check_violation then null;end;
 begin perform public.save_native_media_review(eid,jsonb_set(changed,'{takes,0,sha256}',to_jsonb(repeat('a',64))));raise exception 'Review for another take accepted';exception when check_violation then null;end;
 begin perform public.save_native_media_review(eid,jsonb_set(changed,'{lip_sync_verified}','true'));raise exception 'Automatic lip approval accepted';exception when check_violation then null;end;
 perform pg_temp.native_panel_assert(public.save_native_media_review(eid,changed)->>'code'='saved','advisory review saved without artistic approval');
 perform pg_temp.native_panel_assert(public.studio_native_media_review(w,actor,eid)=changed,'member sees the exact bound report');
 begin perform public.studio_native_media_review(w,gen_random_uuid(),eid);raise exception 'Outsider read review';exception when insufficient_privilege then null;end;
 begin perform public.studio_native_media_review(w,actor,gen_random_uuid());raise exception 'Foreign episode read review';exception when insufficient_privilege then null;end;
 perform public.save_native_media_review(eid,jsonb_set(changed,'{takes,0,recognized_text}','"Changed"'));
 perform pg_temp.native_panel_assert(public.studio_native_media_review(w,actor,eid)=changed,'report is immutable when audit is repeated');
 perform pg_temp.native_panel_assert(not has_table_privilege('authenticated','public.studio_native_media_reviews','select') and not has_function_privilege('authenticated','public.save_native_media_review(uuid,jsonb)','execute'),'browser cannot forge or directly read reports');
 perform public.finish_native_chapter(eid,other_token);
 perform pg_temp.native_panel_assert(not has_table_privilege('authenticated','public.studio_native_runs','select'),'private native state hidden from browser');
 perform pg_temp.native_panel_assert(not has_function_privilege('authenticated','public.reserve_native_chapter(uuid,uuid,jsonb)','execute'),'browser cannot invent credit observations');
 perform pg_temp.native_panel_assert(not has_function_privilege('anon','public.save_native_chapter(uuid,uuid,jsonb)','execute'),'anonymous cannot change checkpoints');
 perform pg_temp.native_panel_assert(not has_function_privilege('service_role','public.complete_native_chapter_before_policy(uuid,uuid,text,text,text)','execute'),'worker cannot bypass current editorial policy');
 perform pg_temp.native_panel_assert((select not enabled from public.studio_video_wallets where id=wallet),'native adapter does not enable old WAV wallet');
 perform pg_temp.native_panel_assert((select status='rendered' from public.episodes where id=eid),'worker cannot approve or publish');
end $$;

rollback;
