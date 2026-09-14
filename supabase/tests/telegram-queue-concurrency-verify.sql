\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from public.idea_queue where briefing='Pauta unica enviada simultaneamente por doze workers.')<>1 then
    raise exception 'Duplicate Telegram idea created'; end if;
  if (select count(*) from public.idea_queue where status='pending')<>
    (select (value->>'test_pending_baseline')::integer+3 from public.system_config where key='telegram_queue') then
    raise exception 'Concurrent queue capacity mismatch'; end if;
  if (select count(*) from public.telegram_commands where command='idea' and result->>'code'='created')<>3 then
    raise exception 'Command ledger does not match ideas'; end if;
end $$;
