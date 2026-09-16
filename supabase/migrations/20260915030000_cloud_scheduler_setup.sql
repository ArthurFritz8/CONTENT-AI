-- Cloud prerequisites without requiring psql on the operator machine.
-- Scheduler jobs are defined by the trend-discovery migrations.

do $extensions$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create schema if not exists vault;
    create extension if not exists supabase_vault with schema vault;
  end if;
end;
$extensions$;

insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do update set name = excluded.name, public = true;

