\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Review assertion: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; next_req public.review_requests;
begin
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}' where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/video.mp4' where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  perform pg_temp.expect(req.id is not null,'review prepared');
  next_req:=public.prepare_review('-123','456',ep,false);
  perform pg_temp.expect(next_req.id is null,'no automatic duplicate while sending');
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-123','456',1)='unauthorized','unconfirmed delivery blocked');
  update public.review_requests set delivery_status='sent',message_id=10 where id=req.id;
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-123','999',10)='unauthorized','wrong user');
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-999','456',10)='unauthorized','wrong chat');
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-123','456',11)='unauthorized','wrong message');
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-123','456',10)='approved','approve');
  perform pg_temp.expect((select status='review' and approval_user='456' from public.episodes where id=ep),'approval never publishes');
  perform pg_temp.expect(public.decide_review(req.id,200,'approve','-123','456',10)='approved','replay returns original result');
  perform pg_temp.expect(public.decide_review(req.id,200,'reject','-123','456',10)='unauthorized','update id cannot change action');
  perform pg_temp.expect(public.decide_review(req.id,201,'reject','-123','456',10)='already_decided','second decision blocked');
  perform pg_temp.expect((select count(*)=1 from public.job_events where episode_id=ep and event_type='approval_received'),'one approval event');
  -- Policy changes invalidate approval even without touching the episode row.
  update public.system_config set value=value||'{"review_test":true}' where key='fact_check';
  begin
    update public.episodes set status='published' where id=ep;
    raise exception 'Stale policy accepted';
  exception when check_violation then null; end;
  next_req:=public.prepare_review('-123','456',ep,false);
  perform pg_temp.expect(next_req.id<>req.id,'changed policy creates new review');
  perform pg_temp.expect((select approval_date is null from public.episodes where id=ep),'old approval cleared');
  update public.review_requests set delivery_status='sent',message_id=12 where id=next_req.id;
  -- Asset change invalidates pending callback.
  insert into public.assets(episode_id,type,url,license,source) values(ep,'image','https://example.test/changed.png','own','manual');
  perform pg_temp.expect(public.decide_review(next_req.id,202,'approve','-123','456',12)='stale','asset edit invalidates callback');
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=13 where id=req.id;
  perform pg_temp.expect(public.decide_review(req.id,203,'approve','-123','456',13)='approved','new version approved');
  -- A combined edit + publish cannot read an old fingerprint through a BEFORE trigger.
  begin
    update public.episodes set status='published',render_url='https://example.test/swapped.mp4' where id=ep;
    raise exception 'Combined swap accepted';
  exception when check_violation then null; end;
  update public.episodes set script_json=script_json||'{"edited":true}' where id=ep;
  perform pg_temp.expect((select approval_fingerprint is null and approval_date is null from public.episodes where id=ep),'script edit clears approval');
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=14 where id=req.id;
  perform pg_temp.expect(public.decide_review(req.id,204,'rerender','-123','456',14)='rerender_requested','rerender action');
  perform pg_temp.expect((select status='assets' and render_url is null from public.episodes where id=ep),'rerender preserves legal state');
  perform pg_temp.expect((select count(*)=1 from public.assets where episode_id=ep),'rerender preserves assets');
  update public.episodes set status='rendered',render_url='https://example.test/new.mp4' where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='uncertain' where id=req.id;
  next_req:=public.prepare_review('-123','456',ep,false);
  perform pg_temp.expect(next_req.id is null,'uncertain delivery not retried');
  next_req:=public.prepare_review('-123','456',ep,true);
  perform pg_temp.expect(next_req.id<>req.id,'explicit resend supersedes uncertain message');
  update public.review_requests set delivery_status='sent',message_id=15 where id=next_req.id;
  perform pg_temp.expect(public.decide_review(next_req.id,205,'reject','-123','456',15)='rejected','reject action');
  perform pg_temp.expect((select status='failed' and failure_from_status='review' from public.episodes where id=ep),'rejection keeps origin');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.prepare_review(text,text,uuid,boolean)','execute'),'anon denied');
select pg_temp.expect(not has_function_privilege('authenticated','public.decide_review(uuid,bigint,text,text,text,bigint)','execute'),'user RPC denied');
grant select on public.review_requests,public.telegram_updates,public.telegram_commands to anon;
set local role anon;
select pg_temp.expect((select count(*)=0 from public.review_requests),'review RLS');
select pg_temp.expect((select count(*)=0 from public.telegram_updates),'update RLS');
reset role;
rollback;
