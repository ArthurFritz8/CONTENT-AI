\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.job_events where episode_id='44444444-4444-4444-8444-444444444444' and event_type='approval_received')<>1 then
    raise exception 'Concurrent approval was duplicated';
  end if;
  if (select count(*) from public.telegram_updates where update_id=9001)<>1 then raise exception 'Duplicate update ledger'; end if;
  if (select status from public.episodes where id='44444444-4444-4444-8444-444444444444')<>'review' then raise exception 'Approval changed publication state'; end if;
end $$;
