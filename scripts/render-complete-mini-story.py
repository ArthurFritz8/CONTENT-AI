"""One reserved new reveal, reusing the reviewed worker and existing story assets."""
from decimal import Decimal
import argparse
import datetime
import importlib
import json
import logging
from pathlib import Path
import shutil
import subprocess
import sys
import time
import wave

import modal
import numpy as np
import suitcase_story_contract as contract

story = importlib.import_module("prepare-suitcase-story")
conversation, probe = story.conversation, story.probe
ROOT, OUT = story.ROOT, story.ROOT / "output/complete-mini-story"
logger = logging.getLogger("complete-mini-story")


def request():
    plan = story.preflight()  # includes original image/audio/direction checks
    return next(shot for shot in plan["shots"] if shot["id"] == "05")


def prepare():
    plan = story.preflight()
    plan.update(completion_mode="one-new-reveal", max_new_gpu_calls=1, reused_dialogue_ids=["02"], human_review_required=True)
    OUT.mkdir(parents=True, exist_ok=True)
    selection = {"selected": ["02", "05"], "newly_selected": ["05"], "max_new_gpu_calls": 1,
        "automatic_retry": False, "production_enabled": False, "published": False}
    for name, value in (("plan.json", plan), ("cloud-selection.json", selection)):
        target = OUT / name
        if target.exists() and story.read(target) != value:
            raise ValueError("Existing completion inputs differ; preserve them")
        if not target.exists(): conversation.save(target, value)
    source, target = story.OUT / "02", OUT / "02"
    target.mkdir(exist_ok=True)
    report = story.read(source / "qa.json")
    story.verify(next(s for s in plan["shots"] if s["id"] == "02"), report)
    for name in ("native.mp4", "fluid.mp4", "qa.json", "av-audit.json"):
        original, copied = source / name, target / name
        if name.endswith(".mp4") and story.sha(original) != report["outputs"][name[:-4]]["sha256"]:
            raise ValueError("Reused approved take changed")
        if copied.exists() and copied.read_bytes() != original.read_bytes():
            raise ValueError("Completion checkpoint differs from its source")
        if not copied.exists(): shutil.copyfile(original, copied)
    return plan


def credit_for_one(billing, ceiling):
    if ceiling is None or not ceiling.is_finite() or not 0 < ceiling <= 30:
        raise ValueError("Current operator credit ceiling required")
    metered = Decimal(billing["metered_cost"])
    if not metered.is_finite() or metered < 0:
        raise ValueError("Invalid billing snapshot")
    # Ignore extra grants and free egress adjustments rather than inventing credit.
    remaining = min(ceiling, Decimal("30") - metered)
    if remaining < contract.reserve(1) + contract.KEEP_CREDIT:
        raise ValueError("Credit floor blocks the new take")
    return remaining


def cli(*args):
    return json.loads(subprocess.check_output([sys.executable, "-X", "utf8", "-m", "modal", *args], text=True, timeout=45))


def audit(shot):
    folder = OUT / "05"
    report = story.read(folder / "qa.json")
    story.verify(shot, report)
    with wave.open(str(ROOT / shot["audio"])) as audio:
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
    results = {}
    for name, fps, count in (("native", 16, 64), ("fluid", 60, 237)):
        path = folder / f"{name}.mp4"
        if story.sha(path) != report["outputs"][name]["sha256"]:
            raise ValueError("Completed take changed")
        results[name] = story.auditor.audit(name, fps, count, samples, path=path)
    conversation.save(folder / "av-audit.json", results)


def run(ceiling):
    shot = request()
    OUT.mkdir(parents=True, exist_ok=True)
    folder = OUT / "05"
    folder.mkdir(exist_ok=True)
    markers = [OUT / name for name in ("generation.lock.json", "reservation.json", "failure.json")]
    if (folder / "qa.json").exists():
        audit(shot)
        logger.info("Existing completed reveal verified; zero cloud calls")
        return
    if any(p.exists() for p in markers) or any((folder / name).exists() for name in ("native.mp4", "fluid.mp4")):
        raise ValueError("Reserved, failed or partial call requires inspection; no retry")
    if ceiling is None or not ceiling.is_finite() or not 0 < ceiling <= 30:
        raise ValueError("Current operator credit ceiling required before credentials")
    prepare()
    payload = story.request_for(shot)
    probe.validate_request(**payload)
    with markers[0].open("x", encoding="utf-8") as lock:
        json.dump({"take": "05", "max_new_calls": 1, "automatic_retry": False}, lock)
    app_id, started = None, time.perf_counter()
    try:
        conversation.credentials()
        before = cli("billing", "summary", "--for", datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m"), "--json")
        credit = credit_for_one(before, ceiling)
        rows = cli("app", "list", "--json")
        if any(r["state"] != "stopped" and int(r["tasks"]) > 0 for r in rows):
            raise ValueError("Concurrent workspace workloads block the small reservation")
        reservation = {"take": "05", "max_new_calls": 1, "automatic_retry": False,
            "reported_credit_ceiling_usd": str(ceiling), "conservative_credit_usd": str(credit),
            "reserved_allowance_usd": str(contract.reserve(1)), "keep_credit_planned_usd": str(contract.KEEP_CREDIT),
            "checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "production_enabled": False, "published": False, "database_writes": False}
        conversation.save(OUT / "billing-before.json", before)
        conversation.save(OUT / "reservation.json", reservation)
        conversation.save(OUT / "request.json", shot)
        logger.info("One reveal reserved: USD %s; conservative remainder USD %s", contract.reserve(1), credit - contract.reserve(1))
        with modal.enable_output(), probe.app.run():
            app_id = probe.app.app_id
            conversation.save(OUT / "running.json", {"app_id": app_id, "take": "05", "new_calls": 1})
            report = probe.receive_stream(probe.speak_suitcase.remote_gen(**payload), folder, prefix="")
            story.verify(shot, report)
            conversation.save(folder / "qa.json", {**report, "modal_app_id": app_id,
                "new_worker_seconds": report["worker_entry_seconds"],
                "new_worker_estimate_usd": float(contract.RATE) * report["worker_entry_seconds"], "human_review_pending": True})
        audit(shot)
        rows = cli("app", "list", "--json")
        final = next((r for r in rows if r["app_id"] == app_id), None)
        if not final or final["state"] != "stopped" or int(final["tasks"]) != 0:
            raise ValueError("Generated app must be stopped with zero tasks")
        conversation.save(OUT / "modal-final-state.json", final)
        after = cli("billing", "summary", "--for", datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m"), "--json")
        conversation.save(OUT / "billing-after.json", after)
        conversation.save(OUT / "execution-summary.json", {**reservation, "completed_takes": 1,
            "client_seconds": time.perf_counter() - started, "app_stopped_zero_tasks": True,
            "observed_workspace_metered_delta_usd": str(Decimal(after["metered_cost"]) - Decimal(before["metered_cost"])),
            "observed_workspace_credit_used_delta_usd": str(Decimal(before["adjustments"]["credits"]) - Decimal(after["adjustments"]["credits"])),
            "cost_scope": "workspace billing may lag; delta is not an isolated app invoice", "human_review_pending": True})
        markers[0].unlink()
    except Exception as exc:
        conversation.save(OUT / "failure.json", {"app_id": app_id, "error_type": type(exc).__name__, "automatic_retry": False})
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--credit-ceiling-usd", type=Decimal)
    args = parser.parse_args()
    if args.run:
        run(args.credit_ceiling_usd)
    else:
        prepare()
        shot = request()
        logger.info("Reveal preflight passed: %s; no credentials or cloud calls", shot["text"])
