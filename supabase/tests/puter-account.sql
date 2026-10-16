\set ON_ERROR_STOP on
-- Disposable local PostgreSQL only. Never install a fake Vault in a hosted project.
begin;
do $$begin
 if to_regnamespace('vault') is not null or (inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet,'::1'::inet)) then
  raise exception 'Puter Vault fixture requires an empty local test namespace';
 end if;
end $$;
create schema vault;
create table vault.fixture_secrets(id uuid primary key default gen_random_uuid(),value text);
create view vault.decrypted_secrets as select id,value as decrypted_secret from vault.fixture_secrets;
create function vault.create_secret(p_value text) returns uuid language sql as $$insert into vault.fixture_secrets(value) values(p_value) returning id$$;
create function vault.update_secret(p_id uuid,p_value text) returns void language sql as $$update vault.fixture_secrets set value=p_value where id=p_id$$;
create function pg_temp.puter_assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Puter account assertion: %',label;end if;end $$;
do $$
declare actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid;ow uuid;fw uuid;aid uuid;token uuid:=gen_random_uuid();p jsonb;r jsonb;
begin
 w:=public.studio_provision(actor,'Puter account fixture',false);ow:=public.studio_provision(other,'Shared Puter fixture',false);fw:=public.studio_provision(outsider,'Foreign Puter fixture',false);
 p:=jsonb_build_object('provider','puter','account_sha256',repeat('a',64),'checked_at',now(),'remaining_credits',1000,'monthly_allowance',1000,
  'storage_free_bytes',20000000,'unit','credits','financially_eligible',true,'contract_sha256','af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364',
  'budget_basis','empirical_conservative_estimate','provider_quote',false,'blockers','[]'::jsonb);
 perform pg_temp.puter_assert(public.valid_puter_observation(p),'strict recurring observation');
 perform pg_temp.puter_assert(not public.valid_puter_observation(p||'{"monthly_allowance":2000}'),'changed free allowance denied');
 perform pg_temp.puter_assert(not public.valid_puter_observation(p||'{"unit":"usd"}'),'credit currency not money');
 perform pg_temp.puter_assert(not public.valid_puter_observation(p||'{"unknown":true}'),'unknown observation fields denied');
 perform pg_temp.puter_assert(not public.valid_puter_observation(p||'{"remaining_credits":1001}'),'purchased balance cannot be free');
 begin perform public.studio_puter_connect(w,outsider,'fixture-token-only-not-real',p);raise exception 'Foreign connection accepted';exception when insufficient_privilege then null;end;
 begin perform public.studio_puter_connect(w,actor,'fixture-token-only-not-real',p||jsonb_build_object('checked_at',now()-interval '3 minutes'));raise exception 'Stale inspection accepted';exception when check_violation then null;end;
 r:=public.studio_puter_connect(w,actor,'fixture-token-only-not-real',p);aid:=(r->>'account_id')::uuid;
 perform pg_temp.puter_assert(r->>'code'='connected','account connected');
 perform pg_temp.puter_assert(public.studio_puter_connect(ow,other,'fixture-token-only-not-real',p)->>'account_id'=aid::text,'same actual account shares one pool');
 perform pg_temp.puter_assert((select count(*)=1 from public.studio_puter_accounts where account_sha256=repeat('a',64)),'no duplicate balance');
 perform pg_temp.puter_assert((public.studio_puter_view(w,actor)#>>'{accounts,0,estimated_chapters}')::int=1,'monthly free estimate is one 15s chapter');
 perform pg_temp.puter_assert((public.studio_puter_view(w,actor)::text not like '%fixture-token%'),'no token in dashboard');
 perform pg_temp.puter_assert(public.studio_puter_view(fw,outsider)->'accounts'='[]'::jsonb,'foreign account hidden');
 begin perform public.claim_puter_inspection(aid,gen_random_uuid(),fw,outsider);raise exception 'Foreign secret claimed';exception when insufficient_privilege then null;end;
 r:=public.claim_puter_inspection(aid,token,w,actor);
 perform pg_temp.puter_assert(r->>'code'='claimed' and r->>'credential'='fixture-token-only-not-real','worker claims its protected credential');
 perform pg_temp.puter_assert(public.claim_puter_inspection(aid,gen_random_uuid(),ow,other)->>'code'='account_busy','shared account cannot inspect concurrently');
 perform pg_temp.puter_assert(public.studio_puter_connect(w,actor,'fixture-token-only-not-real',p)->>'code'='account_busy','cannot rotate credential during lease');
 begin perform public.finish_puter_inspection(aid,gen_random_uuid(),p);raise exception 'Foreign lease wrote observation';exception when insufficient_privilege then null;end;
 perform public.finish_puter_inspection(aid,token,p||'{"remaining_credits":677.7}');
 perform pg_temp.puter_assert((public.studio_puter_view(w,actor)#>>'{accounts,0,estimated_chapters}')::int=0,'insufficient full-chapter capacity is not inflated');
 perform pg_temp.puter_assert(public.claim_puter_inspection(aid,gen_random_uuid(),w,actor)->>'code'='cooldown','refresh has per-account cooldown');
 update public.studio_puter_accounts set observed_at=now()-interval '3 minutes' where id=aid;
 perform pg_temp.puter_assert(public.studio_puter_view(w,actor)#>'{accounts,0,estimated_chapters}'='null'::jsonb,'stale budget is unknown');
 perform pg_temp.puter_assert(not has_function_privilege('authenticated','public.studio_puter_connect(uuid,uuid,text,jsonb)','execute'),'browser cannot bypass credential verification');
 perform pg_temp.puter_assert(not has_function_privilege('anon','public.claim_puter_inspection(uuid,uuid,uuid,uuid)','execute'),'anon cannot claim credentials');
 perform pg_temp.puter_assert(not exists(select 1 from public.episodes where workspace_id in(w,ow,fw)),'connecting and refreshing never create episodes');
end $$;
rollback;
