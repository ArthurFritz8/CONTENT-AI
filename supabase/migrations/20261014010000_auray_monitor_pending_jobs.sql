-- Completed history must not grow the recovery batch beyond its bounded contract.
create or replace function public.claim_auray_sync(p_wallet uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.studio_auray_config; jobs jsonb;
begin
 select * into strict c from public.studio_auray_config where wallet_id=p_wallet for update;
 if c.lease_until>now() then return '{"code":"waiting"}'; end if;
 update public.studio_auray_config set lease_token=p_token,lease_until=now()+interval '15 minutes' where wallet_id=p_wallet;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'external_id',external_id,'kind',kind,'aspect_ratio',aspect_ratio,'ready',ready,'status',status,'settled',settled,
  'expected_sha256',expected_sha256,'output_sha256',output_sha256,'bytes',bytes,'path',path) order by created_at,id),'[]') into jobs
 from (select * from public.studio_auray_jobs where wallet_id=p_wallet and not ready and not (settled and status in ('failed','cancelled')) order by created_at,id limit 50) pending;
 return jsonb_build_object('code','claimed','account_sha256',c.account_sha256,'jobs',jobs);
end $$;
