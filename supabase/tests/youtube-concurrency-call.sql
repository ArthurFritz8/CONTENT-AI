\set ON_ERROR_STOP on
do $$ begin
  perform public.claim_youtube_upload('55555555-5555-4555-8555-555555555555',gen_random_uuid());
exception when lock_not_available then null;
end $$;
