\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Buffer YouTube assertion: %',label; end if; end $$;
do $$
declare ep uuid; req public.review_requests; pub public.publishes; owner_id uuid:=gen_random_uuid();
begin
  update public.system_config set value=jsonb_build_object('enabled',true,'provider','buffer',
    'automatic_after',clock_timestamp()-interval '1 minute') where key='buffer_youtube';
  insert into public.episodes default values returning id into ep;
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false},
    "platform_ctas":{"youtube":{"commercial":false}}}'::jsonb where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/portrait.mp4',
    metadata=jsonb_build_object('render_outputs',jsonb_build_object('portrait','https://example.test/portrait.mp4',
      'platforms',jsonb_build_object('youtube',jsonb_build_object('portrait','https://example.test/portrait.mp4')))) where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=99,
    buffer_tiktok_consent=true,buffer_youtube_consent=true where id=req.id;
  perform pg_temp.expect(public.decide_review(req.id,9100,'approve_youtube','-123','456',99)='approved',
    'YouTube-only decision accepted');
  perform pg_temp.expect((select buffer_youtube_consent and not buffer_tiktok_consent
    from public.review_requests where id=req.id),'TikTok consent excluded');
  pub:=public.reserve_buffer_youtube_short(ep,owner_id);
  perform pg_temp.expect(pub.platform='youtube' and pub.variant='portrait' and pub.privacy='public'
    and pub.status='processing','one public Short reservation');
  perform pg_temp.expect((public.reserve_buffer_youtube_short(ep,gen_random_uuid())).id=pub.id,
    'second worker cannot duplicate');
  perform public.record_buffer_youtube_short(pub.id,owner_id,'buffer-short-1','youtube-channel-1');
  perform public.record_buffer_youtube_status(pub.id,'buffer-short-1','scheduled');
  perform pg_temp.expect((select status='processing' from public.publishes where id=pub.id),
    'scheduled is not published');
  perform public.record_buffer_youtube_status(pub.id,'buffer-short-1','sent');
  perform pg_temp.expect((select status='published' and published_at is not null
    from public.publishes where id=pub.id),'sent Short confirmed');
  perform pg_temp.expect((select count(*)=1 from public.publishes where episode_id=ep and platform='youtube'),
    'no duplicate Short');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.reserve_buffer_youtube_short(uuid,uuid)','execute'),
  'anonymous callers denied');
rollback;
