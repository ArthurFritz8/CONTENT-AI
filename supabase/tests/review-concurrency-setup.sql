\set ON_ERROR_STOP on
-- Disposable DB only. Separate from the daily-cap fixture.
insert into public.episodes(id) values('44444444-4444-4444-8444-444444444444');
update public.episodes set status='research' where id='44444444-4444-4444-8444-444444444444';
update public.episodes set status='script',script_json='{"disclosures":{"contains_synthetic_media":true,"commercial_content":false}}' where id='44444444-4444-4444-8444-444444444444';
update public.episodes set status='assets' where id='44444444-4444-4444-8444-444444444444';
update public.episodes set status='rendered',render_url='https://example.test/video.mp4' where id='44444444-4444-4444-8444-444444444444';
update public.episodes set status='review' where id='44444444-4444-4444-8444-444444444444';
select public.prepare_review('123','456','44444444-4444-4444-8444-444444444444',false);
update public.review_requests set delivery_status='sent',message_id=42 where episode_id='44444444-4444-4444-8444-444444444444';
