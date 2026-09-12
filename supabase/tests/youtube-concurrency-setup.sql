\set ON_ERROR_STOP on
do $$
declare ep uuid:='55555555-5555-4555-8555-555555555555'; req public.review_requests;
begin
  insert into public.episodes(id) values(ep);
  update public.episodes set status='research' where id=ep;
  update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}' where id=ep;
  update public.episodes set status='assets' where id=ep;
  update public.episodes set status='rendered',render_url='https://example.test/video.mp4' where id=ep;
  update public.episodes set status='review' where id=ep;
  req:=public.prepare_review('-123','456',ep,false);
  update public.review_requests set delivery_status='sent',message_id=999 where id=req.id;
  perform public.decide_review(req.id,9999,'approve','-123','456',999);
  update public.system_config set value=value||'{"enabled":true}' where key='youtube';
end $$;
