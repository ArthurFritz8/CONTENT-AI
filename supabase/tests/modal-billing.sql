\set ON_ERROR_STOP on
begin;
create function pg_temp.billing_assert(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Billing assertion: %',label; end if; end $$;
do $$
declare actor uuid:=gen_random_uuid(); w uuid; wallet uuid:=gen_random_uuid(); evidence jsonb; result jsonb; execution text:=repeat('a',64);
 renewal timestamptz:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
begin
 w:=public.studio_provision(actor,'Billing audit',false);
 insert into public.studio_video_wallets(id,label,quota_group,unit,free_tier,safety_units) values(wallet,'Modal fixture','modal:audit','usd_micro','recurring',1500000);
 insert into public.studio_video_wallet_access values(wallet,w);
 insert into public.studio_modal_wallet_config(wallet_id,provider_workspace,monthly_allowance_units,entitlement_evidence,entitlement_valid_until)
 values(wallet,'audit',30000000,'verified/plan.png',now()+interval '1 day');
 evidence:=jsonb_build_object('provider_workspace','audit','provider_id','modal-wan-s2v-h100-v1','unit','usd_micro','execution_sha256',execution,
  'balance_kind','conservative_monthly_estimate','billing_may_lag',true,'estimate',true,'cash_cost',0,'requires_verified_zero_spend_limit',true,
  'infrastructure_retry_ceiling_guaranteed',false,'checked_at',now(),'valid_until',least(now()+interval '5 minutes',renewal),'renews_at',renewal,
  'cycle',to_char(now() at time zone 'UTC','YYYY-MM'),'remaining_units',3897939,'metered_units',26102061,'billed_units',0,'per_shot_units',3465430,
  'native_seconds',3.9375,'output_seconds',3.95);
 result:=public.observe_modal_wallet(wallet,evidence);
 perform pg_temp.billing_assert(result->>'enabled'='false','an observation cannot enable a wallet');
 perform pg_temp.billing_assert(not public.studio_modal_eligible(wallet,execution),'zero spend verification and deployment required');
 update public.studio_modal_wallet_config set adapter_ready=true,zero_spend_evidence='verified/spend0.png',zero_spend_valid_until=now()+interval '1 day' where wallet_id=wallet;
 perform pg_temp.billing_assert(not public.studio_modal_eligible(wallet,execution),'policy verification does not enable the wallet');
 perform pg_temp.billing_assert(not public.studio_modal_eligible(wallet,repeat('b',64)),'another execution requires requalification');
 result:=public.studio_video_overview(w,actor);
 perform pg_temp.billing_assert(result#>'{wallets,0,available_units}'='null'::jsonb,'disabled amount not spendable');
 update public.studio_video_wallets set enabled=true where id=wallet;
 perform pg_temp.billing_assert(public.studio_modal_eligible(wallet,execution),'enabled and separately verified source qualifies');
 result:=public.studio_video_overview(w,actor);
 perform pg_temp.billing_assert((result#>>'{wallets,0,available_units}')::bigint=2397939,'safety excluded from spendable funds');
 begin perform public.observe_modal_wallet(wallet,evidence||'{"provider_workspace":"another"}');raise exception 'Wrong account accepted';exception when check_violation then null;end;
 begin perform public.observe_modal_wallet(wallet,evidence||'{"remaining_units":999999999}');raise exception 'Grant minted capacity';exception when check_violation then null;end;
 begin perform public.observe_modal_wallet(wallet,evidence||jsonb_build_object('cycle','2000-01'));raise exception 'Expired cycle accepted';exception when check_violation then null;end;
 begin perform public.observe_modal_wallet(wallet,evidence||jsonb_build_object('checked_at',now()-interval '10 minutes'));raise exception 'Stale billing accepted';exception when check_violation then null;end;
 perform public.observe_modal_wallet(wallet,evidence||'{"billed_units":1}');
 perform pg_temp.billing_assert(not public.studio_modal_eligible(wallet,execution),'cash billed pauses zero cash production');
 perform public.observe_modal_wallet(wallet,evidence);
 update public.studio_modal_wallet_config set zero_spend_valid_until=now()-interval '1 second' where wallet_id=wallet;
 perform pg_temp.billing_assert(public.studio_video_overview(w,actor)#>'{wallets,0,available_units}'='null'::jsonb,'expired policy hides capacity');
 perform pg_temp.billing_assert(not has_function_privilege('authenticated','public.observe_modal_wallet(uuid,jsonb)','execute'),'browser cannot mint billing');
 perform pg_temp.billing_assert(not has_function_privilege('service_role','public.studio_reserve_video_before_billing(uuid,uuid,uuid,uuid,text,jsonb)','execute'),'cannot bypass policy through old RPC');
end $$;
rollback;
