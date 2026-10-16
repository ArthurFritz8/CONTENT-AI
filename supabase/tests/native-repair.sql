\set ON_ERROR_STOP on
begin;
create function pg_temp.native_panel_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Native panel assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;sid uuid;request uuid:=gen_random_uuid();wallet uuid;sample uuid:=gen_random_uuid();account uuid:=gen_random_uuid();token uuid:=gen_random_uuid();pref jsonb;bib jsonb;profile jsonb;r jsonb;refs jsonb:='[]';directions jsonb:='[]';c jsonb;mid uuid;idx int:=0;iid uuid;eid uuid;draft jsonb;run jsonb;tasks jsonb:='[]';proof jsonb;changed jsonb;new_eid uuid;repair_req uuid;edit jsonb;new_draft jsonb;reuse jsonb;source_run jsonb;source_eid uuid;
begin
 w:=public.studio_provision(actor,'Native panel integration',false);
 update public.studio_workspaces set settings=jsonb_set(settings,'{pipeline}','{"max_episodes_per_day":3}') where id=w;
 pref:='{"version":"1.0.0","primary_style":"cinematic_3d","continuity_mode":"fixed","allowed_styles":["cinematic_3d"],"source":"auray","voice_policy":"approved_variants"}';
 bib:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."},{"title":"A porta escondida","arc":"Abrem a porta escondida atrás do portão e descobrem o segredo da feira."}]}';
 perform public.studio_story_claim(w,actor,request,jsonb_build_object('kind','fruits','genre','mystery','chapters',2,'premise',bib->>'premise','presentation',pref));sid:=public.studio_story_save(w,actor,request,bib);
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
 r:=public.studio_story_next(w,actor,sid);iid:=(r->>'idea_id')::uuid;perform pg_temp.native_panel_assert(r->>'code'='queued','native chapter admission independent of Modal gate');
 r:=public.studio_command(w,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',iid,'revision',(select revision from public.idea_queue where id=iid)));eid:=(r->>'episode_id')::uuid;
 update public.episodes set status='research',research_data='[]',research_evidence=jsonb_build_object('type','fiction_plan','context',briefing->'story_context') where id=eid;
 draft:=jsonb_build_object('title','O segredo da chave','summary','Lia e Rui encontram a chave e procuram uma pista para descobrir o segredo da feira.','scenes',jsonb_build_array(
  jsonb_build_object('narration_text','Quem deixou esta chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','surprised'),'prompt','Medium close-up, the reference character raises one hand and speaks naturally.','seed',1),
  jsonb_build_object('narration_text','Era da minha mãe.','visual',jsonb_build_object('speaker_id','rui','on_stage',jsonb_build_array('rui'),'setting','garden','mood','sad'),'prompt','Close-up, the reference character speaks with a quiet gesture and clear eyes.','seed',2),
  jsonb_build_object('narration_text','Vamos descobrir esse segredo!','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia'),'setting','garden','mood','happy'),'prompt','Medium shot, the reference character smiles and speaks with one clear gesture.','seed',3)));
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer saves frozen draft');
 perform pg_temp.native_panel_assert(public.save_native_draft(eid,repeat('a',64),repeat('d',64),draft)->>'code'='prepared','native writer never replaces saved draft');
 perform pg_temp.native_panel_assert(public.native_worker_input(eid)->>'code'='prepare','worker receives the frozen plan and connected wallet');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='dispatch','pipeline dispatches native workflow');
 perform pg_temp.native_panel_assert(public.studio_native_step(eid)->>'code'='waiting_for_runner','duplicate ticks do not duplicate dispatch');
 for idx in 0..2 loop tasks:=tasks||jsonb_build_array(jsonb_build_object('request_key',repeat((idx+1)::text,64),'job_id','video_'||repeat((idx+1)::text,64),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null));end loop;
 run:=jsonb_build_object('version',1,'episode_id',eid,'fingerprint',repeat('d',64),'profile',profile,'context',(select briefing->'story_context' from public.episodes where id=eid),'draft',draft,'reserved_at',now(),'account_id',account,'key_id','fixture','period',to_char(now() at time zone 'UTC','YYYY-MM'),'contract_sha256',profile->>'contract_sha256','initial_plan_remaining',30,'initial_key_remaining',30,'reserved_credits',15,'tasks',tasks,'revision',0,'output',null,'budget_reconciled',false);

 perform public.reserve_native_chapter(eid,wallet,run);
 source_eid:=eid;
 tasks:='[]';
 for idx in 0..2 loop
  tasks:=tasks||jsonb_build_array((run->'tasks'->idx)||jsonb_build_object('phase','ready','charged_credits',5,'settled',true,'clip',jsonb_build_object('request_key',repeat((idx+1)::text,64),'sha256',repeat((idx+4)::text,64),'frames',120,'path','episodes/'||eid||'/native/'||repeat((idx+4)::text,64)||'.mp4')));
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
 perform pg_temp.native_panel_assert(r->>'code'='prepare' and jsonb_array_length(r->'reuse')=2,'worker receives two verified original clips');
 tasks:='[]';
 for idx in 0..2 loop
  c:=jsonb_build_object('request_key',repeat((idx+7)::text,64),'job_id','video_'||repeat((idx+7)::text,64),'phase','planned','charged_credits',0,'settled',false,'clip',null,'error_code',null);
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
rollback;
