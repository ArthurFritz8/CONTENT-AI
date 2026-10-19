alter table public.studio_auray_config
 add column sync_error_code text check(sync_error_code in ('access_denied','missing_api_key','rate_limited','quota_exhausted',
  'transport_failed','service_unavailable','contract_changed','account_mismatch','jobs_pending_reconciliation',
  'studio_rpc_failed','studio_rpc_invalid_response','sync_failed')),
 add column sync_finished_at timestamptz;

create function public.finish_auray_sync(p_wallet uuid,p_token uuid,p_success boolean,p_error text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_success is null or p_success and p_error is not null then raise check_violation;end if;
 if not exists(select 1 from public.studio_auray_config where wallet_id=p_wallet and lease_token=p_token for update) then raise insufficient_privilege;end if;
 update public.studio_auray_config set lease_token=null,lease_until=null,sync_error=not p_success,
  sync_error_code=case when p_success then null else coalesce(p_error,'sync_failed') end,sync_finished_at=now()
  where wallet_id=p_wallet and lease_token=p_token;
 if not p_success then
  update public.studio_video_wallets set valid_until=greatest(checked_at+interval '1 millisecond',now()-interval '1 millisecond')
   where id=p_wallet and checked_at is not null;
 end if;
end $$;

create or replace function public.finish_auray_sync(p_wallet uuid,p_token uuid,p_success boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.finish_auray_sync(p_wallet,p_token,p_success,null);
end $$;

alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_sync_diagnostics;
revoke all on function public.studio_video_overview_before_sync_diagnostics(uuid,uuid) from public,anon,authenticated,service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;wallets jsonb;
begin
 result:=public.studio_video_overview_before_sync_diagnostics(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||case when c.wallet_id is null then '{}'::jsonb else jsonb_build_object(
  'sync_code',case when c.sync_error then c.sync_error_code end,'sync_finished_at',c.sync_finished_at
 ) end order by v->>'label'),'[]') into wallets from jsonb_array_elements(result->'wallets') v
 left join public.studio_auray_config c on c.wallet_id=(v->>'id')::uuid;
 return jsonb_set(result,'{wallets}',wallets);
end $$;

revoke all on function public.finish_auray_sync(uuid,uuid,boolean,text),public.finish_auray_sync(uuid,uuid,boolean),public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_auray_sync(uuid,uuid,boolean,text),public.finish_auray_sync(uuid,uuid,boolean),public.studio_video_overview(uuid,uuid) to service_role;