create function pg_temp.queue_chapter(actor uuid,workspace uuid,wallet uuid,chapter int default 1) returns jsonb language plpgsql as $$
declare sid uuid;eid uuid;voice jsonb;profile_json jsonb;scenes jsonb:='[]';plan jsonb:='[]';binding jsonb;shot jsonb;index int;
 script_sha text:=repeat(replace(gen_random_uuid()::text,'-',''),2);
begin
 voice:=jsonb_build_object('character_id','lia','engine','edge','sample_sha256',repeat('9',64),'version','1.0.0','voice_id','lia-voice');
 profile_json:=jsonb_build_object('orientation','portrait','output_fps',60,'short_edge',704,'references',jsonb_build_array(jsonb_build_object(
  'character_id','lia','path',workspace||'/reference.png','sha256',repeat('e',64))),'voices',jsonb_build_array(voice));
 insert into public.studio_series(workspace_id,bible) values(workspace,'{"title":"Queue fixture","cast":[],"chapters":[]}') returning id into sid;
 insert into public.studio_series_production(series_id,workspace_id,profile,profile_sha256) values(sid,workspace,profile_json,repeat('a',64));
 insert into public.episodes(workspace_id,briefing) values(workspace,jsonb_build_object('story_context',jsonb_build_object('series_id',sid,'chapter_number',chapter))) returning id into eid;
 update public.episodes set status='research' where id=eid;
 for index in 0..4 loop
  binding:=jsonb_build_object('shot_id','take_'||index,'character_id','lia','reference_path',workspace||'/reference.png','reference_sha256',repeat('e',64),
   'audio_path',workspace||'/audio/'||index||'.wav','audio_sha256',repeat('c',64),'audio_seconds',1,'voice_sha256',public.studio_voice_sha256(voice),
   'prompt','Medium close-up with gentle gestures and clear facial identity.','seed',2007);
  scenes:=scenes||jsonb_build_array(jsonb_build_object('id','take_'||index,'order',index,'role',case index when 0 then 'hook' when 4 then 'cta' else 'content' end,
   'narration_text','Where is the key?','duration_seconds',3.95,'animation',binding,'story_visual',jsonb_build_object('speaker_id','lia','on_stage',jsonb_build_array('lia')),
   'transition','cut','ken_burns','static','asset_portrait',null,'asset_landscape',null));
  shot:=binding-'character_id'-'voice_sha256'-'audio_seconds'-'shot_id'||jsonb_build_object('version','1.0.0','id','take_'||index,'kind','dialogue',
   'quality','approved_master','seconds',3.9375,'min_short_edge',704,'min_output_fps',60,'continuity',jsonb_build_object('series_id',sid,'profile_sha256',repeat('a',64)));
  plan:=plan||jsonb_build_array(jsonb_build_object('shot_id','take_'||index,'wallet_id',wallet,'provider_id','modal','execution_sha256',repeat('b',64),
   'reserved_units',10,'cash_cost',0,'script_sha256',script_sha,'input',shot));
 end loop;
 update public.episodes set status='script',script_hash=script_sha,script_json=jsonb_build_object('scenes',scenes,'gap_seconds',0,'music',null,
  'disclosures',jsonb_build_object('contains_synthetic_media',true),'fiction',jsonb_build_object('animation',jsonb_build_object('version','1.0.0',
   'profile_sha256',repeat('a',64),'orientation','portrait','width',704,'height',1280,'output_fps',60,'native_fps',16,'native_frames',64,'output_frames',237))) where id=eid;
 insert into public.studio_video_compatibility(series_id,profile_sha256,wallet_id,provider_id,execution_sha256,kind,evidence_path,approved_by)
 values(sid,repeat('a',64),wallet,'modal',repeat('b',64),'dialogue','test/approved.mp4',actor);
 return jsonb_build_object('episode_id',eid,'series_id',sid,'plan',plan);
end $$;