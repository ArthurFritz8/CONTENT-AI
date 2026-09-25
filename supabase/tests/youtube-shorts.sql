\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Short assertion: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; pub public.publishes; owner_id uuid:=gen_random_uuid();
begin
  update public.system_config set value=value||jsonb_build_object('enabled',true,'public_shorts_enabled',true,
    'api_audit_approved',true,'automatic_after',clock_timestamp()-interval '1 minute') where key='youtube';
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false},
    "platform_ctas":{"youtube":{"commercial":false}}}'::jsonb where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/portrait.mp4',
    metadata=jsonb_build_object('render_outputs',jsonb_build_object('platforms',
      jsonb_build_object('youtube',jsonb_build_object('portrait','https://example.test/portrait.mp4'),
        'tiktok',jsonb_build_object('portrait','https://example.test/tiktok.mp4')))) where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=99 where id=req.id;
  perform public.decide_review(req.id,8800,'approve','-123','456',99);
  begin
    perform public.claim_youtube_short_upload(ep,owner_id); raise exception 'Missing consent accepted';
  exception when check_violation then null; end;
  update public.review_requests set youtube_public_consent=true where id=req.id;
  pub:=public.claim_youtube_short_upload(ep,owner_id);
  perform pg_temp.expect(pub.variant='portrait' and pub.privacy='public' and not pub.commercial_disclosure,
    'organic vertical public upload claimed');
  perform public.authorize_youtube_short_upload(pub.id,owner_id);
  perform public.save_youtube_short_session(pub.id,owner_id,
    'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture',repeat('a',64),100,'UC'||repeat('a',22));
  perform public.finish_youtube_short_upload(pub.id,owner_id,'public12345');
  perform pg_temp.expect((select status='published' and privacy='public' from public.publishes where id=pub.id),
    'public Short confirmed');
  perform pg_temp.expect((select status='review' from public.episodes where id=ep),'episode remains review');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.claim_youtube_short_upload(uuid,uuid)','execute'),'anon denied');
rollback;
