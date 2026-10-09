\set ON_ERROR_STOP on
begin;
create function pg_temp.preparation_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Preparation assertion: %',label; end if; end $$;
do $$
declare actor uuid:=gen_random_uuid(); w uuid; sid uuid; eid uuid; profile text:=repeat('a',64); fingerprint text:=repeat('f',64);
 voice jsonb; profile_json jsonb; context jsonb; draft jsonb; draft_scenes jsonb:='[]'; scenes jsonb:='[]'; binding jsonb;
 token uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); result jsonb; script jsonb; i integer;
 wallet uuid:=gen_random_uuid(); execution text:=repeat('b',64); evidence jsonb; job uuid; lease uuid; cap text:=repeat('7',64);
 renewal timestamptz:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
begin
 w:=public.studio_provision(actor,'Preparation audit',false);
 voice:=jsonb_build_object('character_id','lia','engine','edge','sample_sha256',repeat('9',64),'version','edge-tts-7.2.8-rate0','voice_id','pt-BR-FranciscaNeural');
 profile_json:=jsonb_build_object('orientation','portrait','output_fps',60,'short_edge',704,'references',jsonb_build_array(jsonb_build_object(
  'character_id','lia','path',w||'/reference.png','sha256',repeat('e',64))),'voices',jsonb_build_array(voice));
 insert into public.studio_series(workspace_id,bible) values(w,'{"title":"Segredos da feira","cast":[],"chapters":[]}') returning id into sid;
 context:=jsonb_build_object('series_id',sid);
 insert into public.studio_series_production values(sid,w,profile_json,profile,now());
 insert into public.episodes(workspace_id,briefing) values(w,jsonb_build_object('story_context',context)) returning id into eid;
 update public.episodes set status='research' where id=eid;
 for i in 0..4 loop
  draft_scenes:=draft_scenes||jsonb_build_array(jsonb_build_object('narration_text','Onde está a chave?','visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia')),
   'prompt','Medium close-up with gentle gestures and clear facial identity.','seed',2007));
 end loop;
 draft:=jsonb_build_object('title','A chave misteriosa','summary','Lia encontra uma chave e decide revelar a verdade.','scenes',draft_scenes);
 perform public.save_animation_draft(eid,profile,fingerprint,draft);
 perform pg_temp.preparation_assert(public.studio_story_next(w,actor,sid)->>'code'='animation_setup_required','default activation remains closed');
 update public.system_config set value=value||'{"animated_preparation_enabled":true}' where key='story_production';
 perform pg_temp.preparation_assert(public.studio_story_next(w,actor,sid)->>'code'='completed','enabled gate reaches the original continuity rules');
 perform pg_temp.preparation_assert(public.studio_story_manage(w,actor,sid,'retry')->>'code'='retry_unavailable','enabled retry does not invent a failed chapter');
 perform pg_temp.preparation_assert(public.studio_animation_step(eid)->>'workflow'='prepare','preparation enters the automatic pipeline');
 perform pg_temp.preparation_assert(public.studio_animation_step(eid)->>'code'='waiting_for_runner','duplicate dispatch throttled');
 result:=public.claim_animation_preparation(eid,token);
 perform pg_temp.preparation_assert(result->>'code'='claimed','first lease');
 perform pg_temp.preparation_assert(public.claim_animation_preparation(eid,other)->>'code'='busy','concurrent lease does not duplicate TTS');
 begin perform public.save_animation_draft(eid,profile,repeat('0',64),draft);raise exception 'Changed draft accepted';exception when check_violation then null;end;
 for i in 0..4 loop
  binding:=jsonb_build_object('shot_id','take_'||i,'character_id','lia','reference_path',w||'/reference.png','reference_sha256',repeat('e',64),
   'audio_path',w||'/story-audio/'||eid||'/'||fingerprint||'/take_'||i||'/'||repeat('c',64)||'.wav','audio_sha256',repeat('c',64),'audio_seconds',1,
   'voice_sha256',public.studio_voice_sha256(voice),'prompt',draft_scenes->i->>'prompt','seed',2007);
  begin perform public.save_animation_audio(eid,other,binding);raise exception 'Wrong lease stored audio';exception when insufficient_privilege then null;end;
  begin perform public.save_animation_audio(eid,token,binding||'{"audio_seconds":4}');raise exception 'Too long audio stored';exception when check_violation then null;end;
  perform public.save_animation_audio(eid,token,binding);perform public.save_animation_audio(eid,token,binding);
  begin perform public.save_animation_audio(eid,token,binding||'{"seed":9}');raise exception 'Changed direction stored';exception when check_violation then null;end;
  scenes:=scenes||jsonb_build_array(jsonb_build_object('id','take_'||i,'order',i,'narration_text',draft_scenes->i->>'narration_text','story_visual',draft_scenes->i->'visual',
   'animation',binding,'duration_seconds',3.95,'transition','cut','ken_burns','static','asset_portrait',null,'asset_landscape',null));
 end loop;
 perform public.fail_animation_preparation(eid,token);
 perform pg_temp.preparation_assert((select status='research' from public.episodes where id=eid),'temporary failure preserves resumable state');
 token:=gen_random_uuid();result:=public.claim_animation_preparation(eid,token);
 perform pg_temp.preparation_assert(jsonb_array_length(result->'audio')=5,'resumed runner reuses measured checkpoints');
 script:=jsonb_build_object('episode_id',eid,'prompt_version','2.0.0','gap_seconds',0,'music',null,'scenes',scenes,'disclosures',jsonb_build_object('contains_synthetic_media',true),
  'fiction',jsonb_build_object('context',context,'summary',draft->>'summary','animation',jsonb_build_object('version','1.0.0','profile_sha256',profile,
   'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237)));
 begin perform public.complete_animation_preparation(eid,token,fingerprint,jsonb_set(script,'{scenes,0,narration_text}','"Outra fala"'),repeat('d',64),'{"passed":true}');raise exception 'Different narration accepted';exception when check_violation then null;end;
 perform pg_temp.preparation_assert(public.complete_animation_preparation(eid,token,fingerprint,script,repeat('d',64),'{"passed":true}')->>'code'='prepared','whole measured chapter becomes a script');
 perform pg_temp.preparation_assert(public.complete_animation_preparation(eid,token,fingerprint,script,repeat('d',64),'{"passed":true}')->>'code'='saved','completion idempotent');
 perform pg_temp.preparation_assert(public.fail_animation_preparation(eid,token)->>'code'='already_prepared','late failure cannot undo completed preparation');
 perform pg_temp.preparation_assert((select status='script' from public.episodes where id=eid),'status advanced atomically');
 perform pg_temp.preparation_assert(public.studio_animation_step(eid)->>'code'='source_not_ready','no fake wallet or GPU without qualified source');
 perform pg_temp.preparation_assert(not exists(select 1 from public.studio_video_jobs where episode_id=eid),'audio preparation consumes no GPU reservation');
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,safety_units)
 values(wallet,'Modal chapter fixture','modal:chapter-audit','usd_micro','recurring',true,1500000);
 insert into public.studio_video_wallet_access values(wallet,w);
 insert into public.studio_modal_wallet_config values(wallet,'chapter-audit',30000000,'verified/plan.png',now()+interval '1 day','verified/spend0.png',now()+interval '1 day',true);
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,profile,wallet,'modal-wan-s2v-h100-v1',execution,'dialogue','verified/acting.mp4',actor);
 evidence:=jsonb_build_object('provider_workspace','chapter-audit','provider_id','modal-wan-s2v-h100-v1','unit','usd_micro','execution_sha256',execution,
  'balance_kind','conservative_monthly_estimate','billing_may_lag',true,'estimate',true,'cash_cost',0,'requires_verified_zero_spend_limit',true,
  'infrastructure_retry_ceiling_guaranteed',false,'checked_at',now(),'valid_until',least(now()+interval '5 minutes',renewal),'renews_at',renewal,
  'cycle',to_char(now() at time zone 'UTC','YYYY-MM'),'remaining_units',3897939,'metered_units',26102061,'billed_units',0,'per_shot_units',3465430,
  'native_seconds',3.9375,'output_seconds',3.95);
 perform public.observe_modal_wallet(wallet,evidence);
 result:=public.studio_video_overview(w,actor);
 perform pg_temp.preparation_assert(result#>>'{chapter_quotes,0,can_reserve}'='false','short balance does not fund a whole chapter');
 perform pg_temp.preparation_assert(public.studio_animation_step(eid)->>'code'='insufficient_capacity','no partially funded production');
 perform pg_temp.preparation_assert(not exists(select 1 from public.studio_video_jobs where episode_id=eid),'insufficient balance reserves no scene');
 perform public.observe_modal_wallet(wallet,evidence||'{"remaining_units":30000000,"metered_units":0}');
 result:=public.studio_animation_step(eid);job:=(result->>'target')::uuid;
 perform pg_temp.preparation_assert(result->>'workflow'='video','funded chapter dispatches one shot');
 perform pg_temp.preparation_assert((select count(*)=5 from public.studio_video_jobs where episode_id=eid),'all five reservations atomic');
 perform pg_temp.preparation_assert(public.studio_animation_step(eid)->>'code'='waiting_for_runner','same queued shot does not duplicate dispatch');
 perform public.observe_modal_wallet(wallet,evidence||'{"remaining_units":30000000,"metered_units":0,"per_shot_units":4000000}');
 perform pg_temp.preparation_assert(public.claim_video_job(job)->>'code'='source_rate_changed','increased current rate cannot use an old lower reservation');
 perform pg_temp.preparation_assert(public.studio_animated_progress(w,actor)#>>'{chapters,0,stage}'='awaiting_capacity','paused financial state is visible to the user');
 perform public.observe_modal_wallet(wallet,evidence||'{"remaining_units":30000000,"metered_units":0}');
 result:=public.claim_video_job(job);lease:=(result->>'token')::uuid;
 perform public.register_video_worker(job,lease,cap);
 update public.studio_modal_wallet_config set zero_spend_valid_until=now()-interval '1 second' where wallet_id=wallet;
 perform pg_temp.preparation_assert(public.begin_video_worker(job,cap,'fc-preparation-audit')->>'code'='source_not_ready','revoked spend guard checked before GPU start');
 update public.studio_modal_wallet_config set zero_spend_valid_until=now()+interval '1 day' where wallet_id=wallet;
 perform pg_temp.preparation_assert(public.begin_video_worker(job,cap,'fc-preparation-audit')->>'code'='started','qualified worker starts once');
 update public.studio_animation_dispatches set dispatched_at=now()-interval '21 minutes' where episode_id=eid;
 result:=public.studio_animation_step(eid);
 perform pg_temp.preparation_assert(result->>'target'=job::text,'retry addresses accepted job rather than new inference');
 perform pg_temp.preparation_assert((select count(*)=4 from public.studio_video_jobs where episode_id=eid and state='queued'),'next scenes wait for current result');
 perform pg_temp.preparation_assert(not has_function_privilege('authenticated','public.claim_animation_preparation(uuid,uuid)','execute'),'browser cannot acquire runner lease');
end $$;
rollback;
