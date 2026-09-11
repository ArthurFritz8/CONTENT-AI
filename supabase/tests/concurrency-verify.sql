\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.episodes) <> 2 then raise exception 'Concurrent daily cap failed'; end if;
  if (select count(*) from public.idea_queue where status='consumed') <> 2 then raise exception 'Duplicate/lost consumption'; end if;
  if (select sum(used) from public.api_budget_usage where scope='gemini:kind:text') <> 5 then raise exception 'Concurrent RPM reservation failed'; end if;
end $$;
