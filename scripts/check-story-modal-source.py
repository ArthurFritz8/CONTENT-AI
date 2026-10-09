"""Inspect a registered Modal source without build, deploy, invocation or policy mutation."""
import argparse
import importlib
import json
import sys
from uuid import UUID
from story_modal_readiness import inspect_runtime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wallet", required=True)
    args = parser.parse_args()
    if str(UUID(args.wallet)) != args.wallet:
        raise ValueError("Canonical wallet ID required")
    db = importlib.import_module("run-story-video-worker").Studio()
    rows = db.table("studio_modal_wallet_config", select="provider_workspace", wallet_id="eq." + args.wallet)
    if len(rows) != 1:
        raise ValueError("Registered Modal policy required")
    report = inspect_runtime(rows[0]["provider_workspace"])
    print(json.dumps({"wallet_id": args.wallet, **report}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Modal source check unavailable; no build or video submitted.", file=sys.stderr)
        sys.exit(1)
