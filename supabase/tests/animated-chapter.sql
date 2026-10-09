\set ON_ERROR_STOP on
begin;
create function pg_temp.animation_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Animation assertion: %',label; end if; end $$;
do $$
declare actor uuid:=gen_random_uuid(); w uuid; sid uuid; eid uuid; wallet uuid:=gen_random_uuid();
 profile text:=repeat('a',64); execution text:=repeat('b',64); voice jsonb; profile_json jsonb; scenes jsonb:='[]';
 shot jsonb; binding jsonb; plan jsonb:='[]'; jobs jsonb; job uuid; lease uuid; cap text; receipt jsonb; manifests jsonb;
 reply jsonb; claim jsonb; render_token uuid:=gen_random_uuid(); h text:=repeat('f',64); path text; quality jsonb; i integer;
begin
 w:=public.studio_provision(actor,'Animated assembly audit',false);
 voice:=jsonb_build_object('character_id','lia','engine','edge','sample_sha256',repeat('9',64),'version','1.0.0','voice_id','lia-voice');
 profile_json:=jsonb_build_object('orientation','portrait','output_fps',60,'short_edge',704,'references',jsonb_build_array(jsonb_build_object(
  'character_id','lia','path',w||'/reference.png','sha256',repeat('e',64))),'voices',jsonb_build_array(voice));
 insert into public.studio_series(workspace_id,bible) values(w,'{"title":"Uma nova feira","kind":"fruits","genre":"drama","cast":[],"chapters":[]}') returning id into sid;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(sid,w,profile_json,profile);
 insert into public.episodes(workspace_id,briefing) values(w,jsonb_build_object('story_context',jsonb_build_object('series_id',sid))) returning id into eid;
 update public.episodes set status='research' where id=eid;
 for i in 0..4 loop
  binding:=jsonb_build_object('shot_id','take_'||i,'character_id','lia','reference_path',w||'/reference.png','reference_sha256',repeat('e',64),
   'audio_path',w||'/audio/'||i||'.wav','audio_sha256',repeat('c',64),'audio_seconds',1,'voice_sha256',public.studio_voice_sha256(voice),
   'prompt','Medium close-up with gentle gestures and clear facial identity.','seed',2007);
  scenes:=scenes||jsonb_build_array(jsonb_build_object('id','take_'||i,'order',i,'role',case i when 0 then 'hook' when 4 then 'cta' else 'content' end,
   'narration_text','Onde está a chave?','duration_seconds',3.95,'animation',binding,'story_visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia')),
   'transition','cut','ken_burns','static','asset_portrait',null,'asset_landscape',null));
  shot:=binding-'character_id'-'voice_sha256'-'audio_seconds'-'shot_id'||jsonb_build_object('version','1.0.0','id','take_'||i,'kind','dialogue',
   'quality','approved_master','seconds',3.9375,'min_short_edge',704,'min_output_fps',60,'continuity',jsonb_build_object('series_id',sid,'profile_sha256',profile));
  plan:=plan||jsonb_build_array(jsonb_build_object('shot_id','take_'||i,'wallet_id',wallet,'provider_id','modal','execution_sha256',execution,
   'reserved_units',10,'cash_cost',0,'script_sha256',repeat('d',64),'input',shot));
 end loop;
 update public.episodes set status='script',script_hash=repeat('d',64),script_json=jsonb_build_object('scenes',scenes,'gap_seconds',0,'music',null,
  'disclosures',jsonb_build_object('contains_synthetic_media',true),'fiction',jsonb_build_object('animation',jsonb_build_object('version','1.0.0',
   'profile_sha256',profile,'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237))) where id=eid;
 perform pg_temp.animation_assert(public.mount_animated_chapter(eid,'https://audit.supabase.co')->>'code'='awaiting_plan','no plan cannot promote');
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,enabled,remaining_units,checked_at,valid_until)
 values(wallet,'Assembly fixture','assembly-'||wallet,'credits','recurring',true,100,now(),now()+interval '1 hour');
 insert into public.studio_video_wallet_access(wallet_id,workspace_id) values(wallet,w);
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,profile,wallet,'modal',execution,'dialogue','reviewed/control.mp4',actor);
 begin perform public.studio_reserve_video(w,actor,gen_random_uuid(),eid,profile,plan-4); raise exception 'Partial chapter reserved'; exception when check_violation then null; end;
 perform pg_temp.animation_assert(not exists(select 1 from public.studio_video_jobs where episode_id=eid),'invalid plan consumes no units');
 reply:=public.studio_reserve_video(w,actor,gen_random_uuid(),eid,profile,plan); jobs:=reply->'job_ids';
 perform pg_temp.animation_assert(public.mount_animated_chapter(eid,'https://audit.supabase.co')->>'code'='waiting_for_clips','partial chapter cannot promote');
 for i in 0..4 loop
  job:=(jobs->>i)::uuid; reply:=public.claim_video_job(job); lease:=(reply->>'token')::uuid;
  cap:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  perform public.register_video_worker(job,lease,cap); perform public.begin_video_worker(job,cap,'fc-assembly-'||job);
  receipt:=jsonb_build_object('human_review_required',true,'lip_sync_validated',false,'execution_sha256',execution,'reference_sha256',repeat('e',64),
   'input_audio_sha256',repeat('c',64),'input_audio_seconds',1,'native_fps',16,'native_frames',64,'output_fps',60,'output_frames',237,'width',704,'height',1280);
  manifests:=jsonb_build_object('native',jsonb_build_object('sha256',repeat('1',64),'size',100),'fluid',jsonb_build_object('sha256',repeat('2',64),'size',120));
  perform public.complete_video_worker(job,cap,receipt,manifests);
 end loop;
 update public.episodes set script_json=jsonb_set(script_json,'{scenes,0,animation,audio_sha256}',to_jsonb(repeat('0',64))) where id=eid;
 begin perform public.mount_animated_chapter(eid,'https://audit.supabase.co'); raise exception 'Changed speech mounted'; exception when check_violation then null; end;
 update public.episodes set script_json=jsonb_set(script_json,'{scenes,0,animation,audio_sha256}',to_jsonb(repeat('c',64))) where id=eid;
 perform pg_temp.animation_assert(public.mount_animated_chapter(eid,'https://audit.supabase.co')->>'code'='mounted','complete chapter promotes to assets');
 perform public.mount_animated_chapter(eid,'https://audit.supabase.co');
 perform pg_temp.animation_assert((select count(*)=10 from public.assets where episode_id=eid),'idempotent mount has five clips and PCM files');
 perform pg_temp.animation_assert((select status='assets' and render_url is null from public.episodes where id=eid),'not approved or published');
 begin perform public.claim_animated_render(eid,null); raise exception 'Null CPU lease accepted'; exception when insufficient_privilege then null; end;
 claim:=public.claim_animated_render(eid,render_token);
 perform pg_temp.animation_assert(claim->>'code'='claimed' and jsonb_array_length(claim->'sources')=5,'CPU claim returns all verified sources');
 perform pg_temp.animation_assert(public.claim_animated_render(eid,gen_random_uuid())->>'code'='busy','second assembler blocked');
 path:=w||'/animated/'||eid||'/'||(claim->>'source_sha256')||'/'||h||'.mp4';
 quality:=jsonb_build_object('version','1.0.0','orientation','portrait','profile_sha256',profile,'decode_verified',true,'human_review_required',true,'lip_sync_validated',false,
  'width',704,'height',1280,'fps',60,'frame_count',1185,'duration_seconds',19.75,'size_bytes',1000);
 begin perform public.complete_animated_render(eid,null,claim->>'source_sha256',path,h,quality,'https://audit.supabase.co');
  raise exception 'Null CPU lease completed'; exception when insufficient_privilege then null; end;
 update public.episodes set script_json=jsonb_set(script_json,'{scenes,0,narration_text}','"Fala alterada durante a montagem"') where id=eid;
 begin perform public.complete_animated_render(eid,render_token,claim->>'source_sha256',path,h,quality,'https://audit.supabase.co');
  raise exception 'Stale render replaced edited dialogue'; exception when check_violation then null; end;
 update public.episodes set script_json=jsonb_set(script_json,'{scenes,0,narration_text}','"Onde está a chave?"') where id=eid;
 begin perform public.complete_animated_render(eid,gen_random_uuid(),claim->>'source_sha256',path,h,quality,'https://audit.supabase.co');
  raise exception 'Wrong CPU lease completed'; exception when insufficient_privilege then null; end;
 begin perform public.complete_animated_render(eid,render_token,claim->>'source_sha256',path,h,jsonb_set(quality,'{fps}','30'),'https://audit.supabase.co');
  raise exception 'FPS downgraded'; exception when check_violation then null; end;
 perform public.complete_animated_render(eid,render_token,claim->>'source_sha256',path,h,quality,'https://audit.supabase.co');
 perform public.complete_animated_render(eid,render_token,claim->>'source_sha256',path,h,quality,'https://audit.supabase.co');
 perform pg_temp.animation_assert((select status='rendered' and render_url is not null from public.episodes where id=eid),'rendered awaits normal human review');
 perform pg_temp.animation_assert((select sum(reserved_units)=50 from public.studio_video_jobs where episode_id=eid and not balance_reconciled),'assembly does not free or reuse unbilled GPU reservations');
 perform pg_temp.animation_assert(not has_function_privilege('authenticated','public.mount_animated_chapter(uuid,text)','execute'),'browser cannot mount or forge proof');
 perform pg_temp.animation_assert(public.studio_story_next(w,actor,sid)->>'code'='animation_setup_required','animated identity cannot fall back to illustrated next chapter');
 perform pg_temp.animation_assert(jsonb_array_length(public.studio_animated_progress(w,actor)->'chapters')=1,'workspace-scoped chapter progress');
end $$;
rollback;
