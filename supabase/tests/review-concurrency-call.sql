\set ON_ERROR_STOP on
select public.decide_review((select id from public.review_requests where episode_id='44444444-4444-4444-8444-444444444444'),9001,'approve','123','456',42);
