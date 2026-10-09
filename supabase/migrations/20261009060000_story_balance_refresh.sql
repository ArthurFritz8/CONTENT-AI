-- Read-only provider queries share one cooldown per physical wallet, across workspaces.
create table public.studio_video_balance_refreshes (
 wallet_id uuid primary key references public.studio_modal_wallet_config(wallet_id),
 requested_at timestamptz not null
);
alter table public.studio_video_balance_refreshes enable row level security;
revoke all on public.studio_video_balance_refreshes from public,anon,authenticated;
grant all on public.studio_video_balance_refreshes to service_role;
create function public.studio_modal_balance_request(p_workspace uuid,p_actor uuid,p_wallet uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.studio_assert_member(p_workspace,p_actor);
 if not exists(select 1 from public.studio_video_wallet_access where wallet_id=p_wallet and workspace_id=p_workspace) then
  raise insufficient_privilege;
 end if;
 perform 1 from public.studio_video_wallets where id=p_wallet for update;
 if not exists(select 1 from public.studio_modal_wallet_config where wallet_id=p_wallet and entitlement_valid_until>now()) then
  return '{"code":"entitlement_unverified"}';
 end if;
 if exists(select 1 from public.studio_video_balance_refreshes where wallet_id=p_wallet and requested_at>now()-interval '2 minutes') then
  return '{"code":"waiting"}';
 end if;
 insert into public.studio_video_balance_refreshes values(p_wallet,now())
 on conflict(wallet_id) do update set requested_at=excluded.requested_at;
 -- Neither this request nor its workflow can activate a source or release job reservations.
 return '{"code":"dispatch"}';
end $$;
revoke all on function public.studio_modal_balance_request(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_modal_balance_request(uuid,uuid,uuid) to service_role;
