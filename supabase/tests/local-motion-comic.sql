\set ON_ERROR_STOP on
begin;
do $$
declare actor uuid:=gen_random_uuid();workspace uuid;series uuid;request uuid;result jsonb;idea uuid;episode uuid;pref jsonb;source text;
 bible jsonb:='{"kind":"fruits","genre":"mystery","title":"A chave da feira","premise":"Duas frutas encontram uma chave misteriosa na feira.","cast":[{"id":"lia","name":"Lia","appearance":"apple","color":"#ef1234","personality":"Curiosa e amiga de todos.","voice":"female"},{"id":"rui","name":"Rui","appearance":"orange","color":"#fab123","personality":"Impulsivo e muito curioso.","voice":"male"}],"chapters":[{"title":"A chave misteriosa","arc":"Os amigos encontram a chave dourada e decidem procurar juntos a porta escondida da feira."}]}';
begin
 workspace:=public.studio_provision(actor,'Local comic audit',false);
 foreach source in array array['local','automatic','puter'] loop
  pref:=jsonb_build_object('version','1.0.0','primary_style','motion_comic','continuity_mode','fixed','allowed_styles',jsonb_build_array('motion_comic'),'source',source,'voice_policy','preserve');
  request:=gen_random_uuid();perform public.studio_story_claim(workspace,actor,request,jsonb_build_object('kind','fruits','genre','mystery','chapters',1,'premise',bible->>'premise','presentation',pref));
  series:=public.studio_story_save(workspace,actor,request,bible);
  result:=public.studio_story_next_presented(workspace,actor,series);
  if source<>'local' then
   if result->>'code'<>'style_preparation_required' then raise exception 'Comic used another source';end if;
   continue;
  end if;
  if result->>'code'<>'queued' then raise exception 'Explicit local comic not admitted';end if;
  idea:=(result->>'idea_id')::uuid;
  if public.studio_story_next_presented(workspace,actor,series)->>'idea_id'<>idea::text then raise exception 'Comic duplicated its chapter';end if;
  if (select story_context->>'local_comic' from public.idea_queue where id=idea) is distinct from 'true' then raise exception 'Comic format not frozen';end if;
  result:=public.studio_command(workspace,actor,gen_random_uuid(),'generate_video',jsonb_build_object('id',idea,'revision',(select revision from public.idea_queue where id=idea)));
  episode:=(result->>'episode_id')::uuid;
  if not public.studio_story_local_comic_episode(episode) or public.story_episode_profile_hash(episode) is not null then raise exception 'Comic routed to animated production';end if;
  if exists(select 1 from public.studio_video_jobs where episode_id=episode) or exists(select 1 from public.studio_puter_runs where episode_id=episode) then raise exception 'Comic reserved external credits';end if;
 end loop;
 if has_function_privilege('authenticated','public.studio_story_local_comic_episode(uuid)','execute') or
  has_function_privilege('service_role','public.studio_story_next_presented_before_comic(uuid,uuid,uuid,text)','execute') then raise exception 'Comic admission exposed';end if;
end $$;
rollback;