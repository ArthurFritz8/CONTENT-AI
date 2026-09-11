-- ONLY for an empty disposable PostgreSQL database, never a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
-- Storage APIs/extensions are tested separately in the hosted smoke test.
