"""Authorized runner only; an observation never enables a wallet or reconciles old charges."""
import argparse, importlib, json, os, re, sys
from story_modal_budget import refresh

def main():
    p=argparse.ArgumentParser();p.add_argument("--wallet",required=True);args=p.parse_args()
    if os.environ.get("GITHUB_ACTIONS") != "true" or not re.fullmatch(r"[a-f0-9-]{36}",args.wallet):
        raise ValueError("Authorized runner and wallet required")
    Studio=importlib.import_module("run-story-video-worker").Studio
    result=refresh(Studio(),args.wallet)
    print(json.dumps({"wallet_id":args.wallet,**result}))

if __name__ == "__main__":
    try: main()
    except Exception:
        print("Modal balance unavailable; no video submitted.",file=sys.stderr);sys.exit(1)
