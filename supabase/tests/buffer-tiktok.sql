\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Buffer assertion: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; pub public.publishes; owner_id uuid:=gen_random_uuid();
begin
  update public.system_config set value=jsonb_build_object('enabled',true,
    'automatic_after',clock_timestamp()-interval '1 minute') where key='buffer_tiktok';
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false},
    "platform_ctas":{"tiktok":{"commercial":false}}}'::jsonb where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/portrait.mp4',
    metadata=jsonb_build_object('render_outputs',jsonb_build_object('platforms',
      jsonb_build_object('tiktok',jsonb_build_object('portrait','https://example.test/tiktok.mp4',
        'commercial',false)))) where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=99 where id=req.id;
  perform public.decide_review(req.id,9000,'approve','-123','456',99);
  begin
    perform public.reserve_buffer_tiktok_post(ep,owner_id); raise exception 'Missing TikTok consent accepted';
  exception when check_violation then null; end;
  update public.review_requests set buffer_tiktok_consent=true where id=req.id;
  pub:=public.reserve_buffer_tiktok_post(ep,owner_id);
  perform pg_temp.expect(pub.platform='tiktok' and pub.variant='portrait' and pub.privacy='public'
    and pub.status='processing','one organic TikTok reservation');
  perform pg_temp.expect((public.reserve_buffer_tiktok_post(ep,gen_random_uuid())).id=pub.id,
    'second worker receives same reservation, not another send');
  perform public.record_buffer_tiktok_post(pub.id,owner_id,'buffer-post-1','tiktok-channel-1');
  perform public.record_buffer_tiktok_status(pub.id,'buffer-post-1','scheduled');
  perform pg_temp.expect((select status='processing' from public.publishes where id=pub.id),
    'queued is not published');
  perform public.record_buffer_tiktok_status(pub.id,'buffer-post-1','sent');
  perform pg_temp.expect((select status='published' and published_at is not null from public.publishes where id=pub.id),
    'sent post confirmed');
  perform pg_temp.expect((select count(*)=1 from public.publishes where episode_id=ep and platform='tiktok'),
    'no duplicate publish row');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.reserve_buffer_tiktok_post(uuid,uuid)','execute'),
  'anonymous callers denied');
rollback;
