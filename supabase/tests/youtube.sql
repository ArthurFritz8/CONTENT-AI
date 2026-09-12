\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'YouTube assertion: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; pub public.publishes; again public.publishes;
  owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); session text:='https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture';
begin
  update public.system_config set value=value||'{"enabled":false}' where key='youtube';
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}' where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/video.mp4' where id=ep;
  update public.episodes set status='review' where id=ep;
  begin
    perform public.claim_youtube_upload(ep,owner_id); raise exception 'Unapproved upload accepted';
  exception when check_violation then null; end;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=99 where id=req.id;
  perform public.decide_review(req.id,8000,'approve','-123','456',99);
  begin
    perform public.claim_youtube_upload(ep,owner_id); raise exception 'Disabled upload accepted';
  exception when check_violation then null; end;
  update public.system_config set value=value||'{"enabled":true}' where key='youtube';
  pub:=public.claim_youtube_upload(ep,owner_id);
  update public.system_config set value=value||'{"configuration_repaired":true}' where key='youtube';
  pub:=public.claim_youtube_upload(ep,owner_id);
  perform pg_temp.expect(pub.upload_config->'configuration_repaired'='true'::jsonb,'pre-session configuration repair');
  perform public.authorize_youtube_session(pub.id,owner_id);
  perform public.authorize_youtube_session(pub.id,owner_id);
  perform public.authorize_youtube_session(pub.id,owner_id);
  begin
    perform public.authorize_youtube_session(pub.id,owner_id); raise exception 'Daily session limit bypassed';
  exception when check_violation then null; end;
  perform pg_temp.expect(pub.review_request_id=req.id and pub.privacy='private','snapshot-bound private upload');
  begin
    perform public.claim_youtube_upload(ep,other_owner); raise exception 'Concurrent upload accepted';
  exception when lock_not_available then null; end;
  begin
    perform public.save_youtube_session(pub.id,other_owner,session,repeat('a',64),100,'UC'||repeat('a',22)); raise exception 'Wrong owner checkpoint';
  exception when check_violation then null; end;
  perform public.save_youtube_session(pub.id,owner_id,session,repeat('a',64),100,'UC'||repeat('a',22));
  begin
    perform public.save_youtube_session(pub.id,owner_id,session||'2',repeat('a',64),100,'UC'||repeat('a',22)); raise exception 'Replaced session';
  exception when check_violation then null; end;
  -- Expired lease can resume the SAME immutable session; old owner is fenced.
  update public.publishes set lease_until=now()-interval '1 second' where id=pub.id;
  update public.system_config set value=value||'{"configuration_repaired":false}' where key='youtube';
  again:=public.claim_youtube_upload(ep,other_owner);
  perform pg_temp.expect(again.id=pub.id and again.session_url=session,'resume same ledger/session');
  perform pg_temp.expect(again.upload_config->'configuration_repaired'='true'::jsonb,'session config remains immutable');
  begin
    perform public.check_youtube_upload(pub.id,owner_id); raise exception 'Expired owner accepted';
  exception when check_violation then null; end;
  update public.system_config set value=value||'{"youtube_test":true}' where key='fact_check';
  begin
    perform public.check_youtube_upload(pub.id,other_owner); raise exception 'Changed approval accepted';
  exception when check_violation then null; end;
  -- External completion cannot be lost if revocation raced the final HTTP request.
  perform public.finish_youtube_upload(pub.id,other_owner,'private1234');
  perform public.finish_youtube_upload(pub.id,other_owner,'private1234');
  perform pg_temp.expect((select status='review' from public.episodes where id=ep),'private upload does not publish episode');
  perform pg_temp.expect((select count(*)=1 from public.job_events where episode_id=ep and event_type='publish_completed'),'one completion event');
  again:=public.claim_youtube_upload(ep,owner_id);
  perform pg_temp.expect(again.external_id='private1234','completed upload returned, never repeated');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.claim_youtube_upload(uuid,uuid)','execute'),'anon denied');
select pg_temp.expect(not has_function_privilege('authenticated','public.save_youtube_session(uuid,uuid,text,text,bigint,text)','execute'),'user session denied');
grant select on public.publishes to anon;
set local role anon;
select pg_temp.expect((select count(*)=0 from public.publishes),'upload/session RLS');
reset role;
rollback;
