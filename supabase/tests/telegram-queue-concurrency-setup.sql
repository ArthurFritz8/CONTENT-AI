\set ON_ERROR_STOP on
update public.system_config set value=jsonb_build_object('enabled',true,'max_additions_per_day',10,
  'max_pending',(select count(*)+3 from public.idea_queue where status='pending'),
  'test_pending_baseline',(select count(*) from public.idea_queue where status='pending')) where key='telegram_queue';
