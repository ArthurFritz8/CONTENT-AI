\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; script jsonb := '{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}';
begin
  begin
    insert into public.episodes(status) values('published');
    raise exception 'Insert bypass accepted';
  exception when check_violation then null; end;
  insert into public.episodes default values returning id into ep;
  begin
    update public.episodes set status='assets' where id=ep;
    raise exception 'Skip accepted';
  exception when check_violation then null; end;
  update public.episodes set status='failed',failure_reason='test' where id=ep;
  begin
    update public.episodes set status='review' where id=ep;
    raise exception 'Retry bypass accepted';
  exception when check_violation then null; end;
  update public.episodes set status='idea' where id=ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json=script where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/video.mp4' where id=ep;
  update public.episodes set status='review' where id=ep;
  begin
    update public.episodes set status='published' where id=ep;
    raise exception 'Missing approval accepted';
  exception when check_violation then null; end;
  req:=public.prepare_review('123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=1 where id=req.id;
  perform public.decide_review(req.id,100,'approve','123','456',1);
  update public.episodes set status='published' where id=ep;
  update public.episodes set status='failed',failure_reason='analytics' where id=ep;
  update public.episodes set status='published' where id=ep;
  update public.episodes set status='analyze' where id=ep;
  perform pg_temp.assert_true((select count(*)>0 from public.job_events where episode_id=ep and event_type='state_transition'),'transitions audited');
end $$;

do $$
declare ep uuid;
begin
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}' where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/video' where id=ep;
  update public.episodes set status='review',approval_user='human',approval_date=now() where id=ep;
  insert into public.assets(episode_id,type,url,license,source,metadata)
    values(ep,'image','https://example.test/image','own','manual','{"scene_order":0}');
  update public.episodes set status='script' where id=ep;
  perform pg_temp.assert_true((select approval_date is null and render_url is null and metadata ? 'render_generation' from public.episodes where id=ep),'refazer invalidates approval/render');
  perform pg_temp.assert_true(not exists(select 1 from public.assets where episode_id=ep),'refazer retires active assets');
  perform pg_temp.assert_true(exists(select 1 from public.job_events where episode_id=ep and jsonb_array_length(metadata->'previous_assets')=1),'refazer archives assets');
end $$;

grant select on public.episodes to anon;
do $$
declare ep uuid;
begin
  insert into public.episodes default values returning id into ep;
  perform pg_temp.assert_true((select research_evidence is null from public.episodes where id=ep),'legacy evidence is nullable');
  update public.episodes set status='research', research_data='[{"claim":"Fixture"}]',
    research_evidence='{"version":"1.0.0","parts":["fixture"]}' where id=ep;
  perform pg_temp.assert_true((select status='research' and research_evidence->>'version'='1.0.0' from public.episodes where id=ep),'evidence and research saved together');
  begin
    update public.episodes set research_evidence='[]' where id=ep;
    raise exception 'Non-object evidence accepted';
  exception when check_violation then null; end;
  begin
    update public.episodes set research_evidence=jsonb_build_object('oversized',repeat('a',262144)) where id=ep;
    raise exception 'Oversized evidence accepted';
  exception when check_violation then null; end;
end $$;
set local role anon;
select pg_temp.assert_true((select count(*)=0 from public.episodes),'RLS hides episodes from anon');
reset role;

select pg_temp.assert_true(not has_function_privilege('anon','public.consume_next_idea()','execute'),'anon RPC denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.reserve_gemini_call(text,text)','execute'),'user budget RPC denied');
select pg_temp.assert_true(not public.reserve_gemini_call('image','gemini-2.5-flash-image'),'paid image denied');
select pg_temp.assert_true(not public.reserve_gemini_call('text','unknown-model'),'unknown model denied');
update public.system_config set value=jsonb_set(value,'{gemini_models,gemini-2.5-flash,rpm}','1') where key='budget';
select pg_temp.assert_true(public.reserve_gemini_call('text','gemini-2.5-flash'),'first reservation');
select pg_temp.assert_true(not public.reserve_gemini_call('grounding','gemini-2.5-flash'),'shared model RPM enforced');

update public.system_config set value=jsonb_set(value,'{max_episodes_per_day}','100') where key='pipeline';
insert into public.idea_queue(briefing,niche) values('Fixture only','gadgets');
select * from public.consume_next_idea();
select pg_temp.assert_true((select count(*)=1 from public.idea_queue where briefing='Fixture only' and status='consumed'),'atomic consume');
update public.system_config set value=jsonb_set(value,'{max_episodes_per_day}','0') where key='pipeline';
insert into public.idea_queue(briefing,niche) values('Must remain pending','gadgets');
select pg_temp.assert_true(not exists(select 1 from public.consume_next_idea()),'daily cap');
select pg_temp.assert_true((select status='pending' from public.idea_queue where briefing='Must remain pending'),'queue preserved');
rollback;
