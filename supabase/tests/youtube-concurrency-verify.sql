\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.publishes where episode_id='55555555-5555-4555-8555-555555555555')<>1
    or (select count(*) from public.job_events where episode_id='55555555-5555-4555-8555-555555555555' and event_type='publish_started')<>1 then
    raise exception 'Concurrent upload reservation was duplicated'; end if;
end $$;
