-- Explicit video generation continues without automatic queue consumption (ADR-042).
create or replace function public.studio_command(p_workspace uuid,p_actor uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare idea public.idea_queue; ep uuid; result jsonb; prior public.web_panel_commands; w public.studio_workspaces; cap int; profile jsonb;
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 perform pg_advisory_xact_lock(hashtext('content-ai-daily-cap'));
 perform pg_advisory_xact_lock(hashtext('studio-command-'||p_workspace));
 perform pg_advisory_xact_lock(hashtext(p_request::text));
 select * into prior from public.web_panel_commands where request_id=p_request;
 if found then
   if prior.actor<>p_actor or prior.workspace_id<>p_workspace or prior.action<>p_action or prior.payload<>p_payload then raise insufficient_privilege; end if;
   return prior.result;
 end if;
 if p_action in ('edit','cancel','choose_product','generate_video') then
   select * into idea from public.idea_queue where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;
   if not found then raise insufficient_privilege using message='Idea unavailable'; end if;
 end if;
 if p_workspace='00000000-0000-4000-8000-000000000001' and p_action not in ('editorial','candidate') and not (p_action='generate_video' and idea.source<>'trend_discovery') then
   if p_action in ('choose_product','generate_video') then
     return public.web_panel_candidate_action(p_request,p_actor,p_action,p_payload);
   end if;
   return public.web_panel_mutation(p_request,p_actor,p_action,p_payload);
 end if;
 select * into strict w from public.studio_workspaces where id=p_workspace for update;
 if w.id='00000000-0000-4000-8000-000000000001' then
   w.settings:=jsonb_set(w.settings,'{pipeline}',(select value from public.system_config where key='pipeline'));
 end if;
 if p_action='editorial' then
   if p_payload->>'theme' not in ('gadgets','geek','novelas','finance','casa','games','ciencia') or char_length(coalesce(p_payload->>'focus',''))>500 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{editorial}',p_payload),updated_at=now() where id=w.id;
   if w.id='00000000-0000-4000-8000-000000000001' then
     update public.system_config set value=value||'{"enabled":false}' where key='trend_discovery';
   end if;
   result:='{"code":"saved"}';
 elsif p_action in ('candidate','add') then
   if char_length(coalesce(p_payload->>'briefing','')) not between 20 and 2000 then raise check_violation; end if;
   if (select count(*) from public.idea_queue where workspace_id=w.id and status='pending')>=30 then return '{"code":"queue_full"}'; end if;
   if (select count(*) from public.idea_queue where workspace_id=w.id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=10 then return '{"code":"daily_limit"}'; end if;
   profile:=coalesce(w.settings->'editorial','{"theme":"gadgets"}');
   if p_action='candidate' then
     if not exists(select 1 from public.studio_discoveries where workspace_id=w.id and id=(p_payload->>'discovery_id')::uuid and expires_at>now() and candidates @> jsonb_build_array(p_payload->'candidate')) then raise check_violation using message='Candidate must come from verified discovery'; end if;
     select d.profile into profile from public.studio_discoveries d where id=(p_payload->>'discovery_id')::uuid and workspace_id=w.id;
     select * into idea from public.idea_queue where workspace_id=w.id and selected_product=p_payload#>>'{candidate,title}' and selected_evidence_url=p_payload#>>'{candidate,source_url}' and status in ('pending','consumed') limit 1;
     if found then return jsonb_build_object('code','created','idea_id',idea.id); end if;
   end if;
   insert into public.idea_queue(workspace_id,briefing,niche,priority,source,editorial_profile,selected_product,selected_hook,selected_evidence_url,recommendations)
   values(w.id,p_payload->>'briefing',coalesce(profile->>'theme','gadgets'),500,case when p_action='candidate' then 'trend_discovery' else 'manual' end,profile,
     case when p_action='candidate' then p_payload#>>'{candidate,title}' end,
     case when p_action='candidate' then p_payload#>>'{candidate,hook}' end,
     case when p_action='candidate' then p_payload#>>'{candidate,source_url}' end,'[]') returning * into idea;
   result:=jsonb_build_object('code','created','idea_id',idea.id);
 elsif p_action='pipeline' then
   if jsonb_typeof(p_payload->'enabled')<>'boolean' or (p_payload->>'max_episodes_per_day')::int not between 1 and 3 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{pipeline}',jsonb_build_object('enabled',p_payload->'enabled','max_episodes_per_day',(p_payload->>'max_episodes_per_day')::int,'require_human_approval',true)),updated_at=now() where id=w.id;
   result:='{"code":"saved"}';
 elsif p_action='niche' then
   if char_length(coalesce(p_payload->>'focus','')) not between 10 and 500 then raise check_violation; end if;
   update public.studio_workspaces set settings=jsonb_set(settings,'{niche,focus}',p_payload->'focus'),updated_at=now() where id=w.id;
   result:='{"code":"saved"}';
 elsif idea.status<>'pending' then result:='{"code":"already_started"}';
 elsif idea.revision is distinct from (p_payload->>'revision')::int then result:='{"code":"conflict"}';
 elsif p_action='cancel' then
   update public.idea_queue set status='rejected' where id=idea.id;
   result:='{"code":"cancelled"}';
 elsif p_action='edit' then
   if char_length(coalesce(p_payload->>'briefing','')) not between 20 and 2000 then raise check_violation; end if;
   update public.idea_queue set briefing=p_payload->>'briefing',validated_at=null where id=idea.id;
   result:='{"code":"updated"}';
 elsif p_action='choose_product' then
   profile:=idea.recommendations->(p_payload->>'index')::int;
   if profile is null or char_length(coalesce(profile->>'product_name','')) not between 8 and 160 then raise check_violation;end if;
   update public.idea_queue set briefing=left(format('Assunto específico: %s. Gancho: %s. Problema: %s. Limitação: %s. Fonte: %s. Vídeo com imagens licenciadas e CTA orgânico.',profile->>'product_name',profile->>'hook',profile->>'problem',profile->>'limitation',profile->>'source_url'),2000),selected_product=profile->>'product_name',selected_hook=profile->>'hook',selected_evidence_url=profile->>'source_url',validated_at=null where id=idea.id;
   result:='{"code":"product_chosen"}';
 elsif p_action='generate_video' then
   -- Explicit generation is independent of the automatic queue switch.
   if idea.source='trend_discovery' and (idea.selected_product is null or idea.selected_hook is null or idea.selected_evidence_url is null) then return '{"code":"product_required"}'; end if;
   if exists(select 1 from public.episodes where workspace_id=w.id and status in ('idea','research','script','assets','rendered')) then return '{"code":"production_busy"}'; end if;
   cap:=least(3,greatest(1,(w.settings#>>'{pipeline,max_episodes_per_day}')::int));
   if (select count(*) from public.episodes where workspace_id=w.id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=cap then return '{"code":"daily_cap_reached"}'; end if;
   update public.idea_queue set validated_at=now(),generation_requested_at=now() where id=idea.id;
   select episode_id into ep from public.consume_idea_unchecked(idea.id);
   if ep is null then raise check_violation; end if;
   result:=jsonb_build_object('code','started','episode_id',ep,'idea_id',idea.id);
 else raise check_violation using message='Unsupported command'; end if;
 insert into public.web_panel_commands(workspace_id,request_id,actor,action,payload,result) values(w.id,p_request,p_actor,p_action,p_payload,result);
 return result;
end $$;

create or replace function public.studio_next_episode() returns setof public.episodes language sql stable security definer set search_path=public,pg_temp as $$
 select e.* from public.episodes e join public.studio_workspaces w on w.id=e.workspace_id
 where e.status in ('idea','research','script','assets','rendered') and
 (w.id<>'00000000-0000-4000-8000-000000000001' or
   exists(select 1 from public.system_config where key='pipeline' and value->>'enabled'='true'))
 order by e.updated_at,e.id limit 1;
$$;
