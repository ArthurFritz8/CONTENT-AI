-- Explain source policy without disclosing operator evidence or minting capacity.
alter function public.studio_video_overview(uuid,uuid) rename to studio_video_overview_before_readiness;
revoke all on function public.studio_video_overview_before_readiness(uuid,uuid) from service_role;
create function public.studio_video_overview(p_workspace uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; wallets jsonb;
begin
 result:=public.studio_video_overview_before_readiness(p_workspace,p_actor);
 select coalesce(jsonb_agg(v||jsonb_build_object('balance_fresh',f.fresh,'source_blockers',
  to_jsonb(array_remove(array[
   case when not w.enabled then 'source_disabled' end,
   case when not f.fresh then 'balance_stale' end,
   case when c.wallet_id is not null and not c.adapter_ready then 'runtime_unverified' end,
   case when c.wallet_id is not null and c.entitlement_valid_until<=now() then 'entitlement_unverified' end,
   case when c.wallet_id is not null and (c.zero_spend_evidence is null or c.zero_spend_valid_until is null or c.zero_spend_valid_until<=now()) then 'spend_limit_unverified' end,
   case when c.wallet_id is not null and coalesce(o.observation->>'billed_units','unknown')<>'0' then 'billing_unverified' end
  ],null)))||case when v ? 'source_ready' then jsonb_build_object('source_ready',coalesce((v->>'source_ready')::boolean and f.fresh,false)) else '{}'::jsonb end
  ||case when o.wallet_id is null then '{}'::jsonb else jsonb_build_object(
   'minimum_chapter_estimate',jsonb_build_object('shots',5,'planned_seconds',19.75,
    'required_units',(o.observation->>'per_shot_units')::bigint*5,'comparison_only',true,
    'shortfall_units',case when f.fresh then greatest(0,(o.observation->>'per_shot_units')::bigint*5-greatest(0,w.remaining_units-(v->>'reserved_units')::bigint-w.safety_units)) else null end)) end
  order by v->>'label'),'[]') into wallets
 from jsonb_array_elements(result->'wallets') v join public.studio_video_wallets w on w.id=(v->>'id')::uuid
 left join public.studio_modal_wallet_config c on c.wallet_id=w.id
 left join public.studio_modal_observations o on o.wallet_id=w.id
 cross join lateral (select coalesce(w.checked_at between now()-interval '5 minutes' and now()+interval '5 seconds' and w.valid_until>now(),false) fresh) f;
 return jsonb_set(result,'{wallets}',wallets);
end $$;
revoke all on function public.studio_video_overview(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_video_overview(uuid,uuid) to service_role;
