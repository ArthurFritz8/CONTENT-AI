"""Read-only billing evidence and conservative H100 quotes; no inference/deployment."""
import calendar
import datetime as dt
from dataclasses import asdict, is_dataclass
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR
from story_video_runtime import GPU_OPTIONS, CPU_OPTIONS
from story_video_transport import PROVIDER, execution_hash

def amount(value):
    if isinstance(value, bool): raise ValueError("Invalid monetary value")
    try: result = Decimal(str(value))
    except InvalidOperation: raise ValueError("Invalid monetary value") from None
    if not result.is_finite(): raise ValueError("Non-finite monetary value")
    return result

def monthly_snapshot(summary, *, allowance_units, now):
    if type(allowance_units) is not int or not 0 < allowance_units <= 1_000_000_000:
        raise ValueError("Recurring allowance must be verified separately")
    if now.tzinfo is None or now.utcoffset() != dt.timedelta(0): raise ValueError("UTC clock required")
    metered, billed = amount(summary["metered_cost"]), amount(summary["billed_cost"])
    if metered < 0 or billed < 0: raise ValueError("Invalid billing summary")
    next_month = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=calendar.monthrange(now.year, now.month)[1]))
    # Ignore grant/egress discounts: they must not mint additional recurring video capacity.
    remaining = max(0, int((Decimal(allowance_units) - metered * 1_000_000).to_integral_value(rounding=ROUND_FLOOR)))
    return {"cycle": now.strftime("%Y-%m"), "checked_at": now.isoformat(), "renews_at": next_month.isoformat(),
        "valid_until": min(now + dt.timedelta(minutes=5), next_month).isoformat(), "remaining_units": remaining,
        "metered_units": int((metered * 1_000_000).to_integral_value(rounding=ROUND_CEILING)),
        "billed_units": int((billed * 1_000_000).to_integral_value(rounding=ROUND_CEILING)),
        "balance_kind": "conservative_monthly_estimate", "billing_may_lag": True}

def h100_quote(rates):
    names = ("gpu_hour_cost_h100", "cpu_hour_cost", "mem_gib_hour_cost", "egress_gib_cost")
    rate = {k: amount(rates[k]) for k in names}
    if any(not 0 < x <= 100 for x in rate.values()): raise ValueError("Missing/current pricing required")
    gpu_seconds = GPU_OPTIONS["timeout"] + GPU_OPTIONS["startup_timeout"] + GPU_OPTIONS["scaledown_window"]
    cpu_seconds = CPU_OPTIONS["timeout"] + CPU_OPTIONS["startup_timeout"] + CPU_OPTIONS["scaledown_window"]
    gpu_cpu = Decimal(str(GPU_OPTIONS["cpu"][1])); gpu_memory = Decimal(GPU_OPTIONS["memory"][1]) / 1024
    relay_cpu = Decimal(str(CPU_OPTIONS["cpu"][1])); relay_memory = Decimal(CPU_OPTIONS["memory"][1]) / 1024
    cost = Decimal(gpu_seconds) / 3600 * (rate["gpu_hour_cost_h100"] + gpu_cpu * rate["cpu_hour_cost"] + gpu_memory * rate["mem_gib_hour_cost"])
    cost += Decimal(cpu_seconds) / 3600 * (relay_cpu * rate["cpu_hour_cost"] + relay_memory * rate["mem_gib_hour_cost"])
    cost += Decimal(120) / 1024 * rate["egress_gib_cost"]
    # Covers bounded transport/operational uncertainty. Infrastructure restarts can exceed this estimate.
    cost += Decimal("0.50")
    units = int((cost * 1_000_000).to_integral_value(rounding=ROUND_CEILING))
    return {"provider_id": PROVIDER, "execution_sha256": execution_hash(), "per_shot_units": units,
        "unit": "usd_micro", "cash_cost": 0, "native_seconds": 63 / 16, "output_seconds": 237 / 60,
        "estimate": True, "resource_rates": {k: str(v) for k, v in rate.items()},
        "requires_verified_zero_spend_limit": True, "infrastructure_retry_ceiling_guaranteed": False}

def observe(config, *, workspace=None, now=None):
    import modal
    now = now or dt.datetime.now(dt.timezone.utc)
    ws = workspace or modal.Workspace.from_context()
    ws.hydrate()
    if ws.name != config["provider_workspace"]: raise ValueError("Credentials point to another workspace")
    summary = ws.billing.summary(now.strftime("%Y-%m"))
    if is_dataclass(summary): summary = asdict(summary)
    snapshot = monthly_snapshot(summary, allowance_units=config["monthly_allowance_units"], now=now)
    quote = h100_quote(ws.billing.rates())
    return {**snapshot, **quote, "provider_workspace": ws.name}

def refresh(db, wallet_id):
    rows = db.table("studio_modal_wallet_config", select="*", wallet_id="eq." + wallet_id)
    if len(rows) != 1: raise ValueError("Modal wallet policy not configured")
    evidence = observe(rows[0])
    return db.rpc("observe_modal_wallet", p_wallet=wallet_id, p_observation=evidence)
