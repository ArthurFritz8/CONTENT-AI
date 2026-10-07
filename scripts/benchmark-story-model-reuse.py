"""Isolated two-take model reuse benchmark. Never deploys, publishes or retries."""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import importlib
import json
import logging
from pathlib import Path
import sys
import time
import wave

import modal
import numpy as np

probe = importlib.import_module("modal-speech-motion-probe")
auditor = importlib.import_module("audit-speech-motion-probe")
conversation = importlib.import_module("render-story-conversation")
ROOT = probe.ROOT
OUT = ROOT / "output/model-reuse-benchmark"
RATE = Decimal("0.00129148")
TIMEOUT = 4200
RESERVE_USD = Decimal("1")  # conservative allowance, not a guaranteed overhead ceiling
REQUIRED_USD = RATE * TIMEOUT + RESERVE_USD
logger = logging.getLogger("model-reuse-benchmark")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def expected_plan():
    baseline = ROOT / "output/stable-hands-motion-probe"
    qa = json.loads((baseline / "qa.json").read_text(encoding="utf-8"))
    review = json.loads((baseline / "operator-review.json").read_text(encoding="utf-8"))
    inputs = json.loads((baseline / "input.json").read_text(encoding="utf-8"))
    if (not review.get("movement_quality_accepted") or
            review.get("video_sha256") != qa["outputs"]["fluid"]["sha256"] or
            digest((baseline / "malu-fluid.mp4").read_bytes()) != review["video_sha256"] or
            inputs["prompt"] != probe.STABLE_HANDS_PROMPT or inputs["negative_prompt"] != probe.NEGATIVE):
        raise ValueError("Benchmark requires the unchanged movement-approved baseline")
    fixed = {"model": probe.MODEL, "model_revision": probe.MODEL_REVISION,
        "wan_commit": probe.WAN_COMMIT, "steps": probe.STEPS, "seed": probe.SEED,
        "native_frames": 64, "native_fps": 16, "output_fps": 60,
        "rife_revision": probe.RIFE_REVISION, "rife_weights_sha256": probe.RIFE_SHA,
        "reference_sha256": probe.REFERENCE_SHA}
    if any(qa.get(key) != value for key, value in fixed.items()):
        raise ValueError("Baseline generation contract changed")
    return {"experiment": "two-identical-takes-model-reuse-v1", "fixed": fixed,
        "reference": "output/humanized-story-pilot/references/malu-close-v1.png",
        "audio": "output/stable-hands-motion-probe/voice.wav", "audio_sha256": qa["input_audio_sha256"],
        "pose": "output/stable-hands-motion-probe/pose.mp4", "pose_sha256": qa["pose_sha256"],
        "prompt": probe.STABLE_HANDS_PROMPT, "negative_prompt": probe.NEGATIVE,
        "generation_settings": dict(probe.GENERATION_SETTINGS),
        "takes": 2, "worker_timeout_seconds": TIMEOUT, "max_new_gpu_calls": 1,
        "worker_upper_estimate_usd": str(RATE * TIMEOUT), "overhead_allowance_usd": str(RESERVE_USD),
        "required_available_credit_usd": str(REQUIRED_USD),
        "budget_scope": "estimate, not invoice; account balance must be supplied from current dashboard",
        "database_writes": False, "production_enabled": False, "published": False,
        "human_review_required": True}


def requests_for(plan):
    if plan != expected_plan():
        raise ValueError("Prepared manifest differs from the reviewed baseline/configuration")
    request = {"png": (ROOT / plan["reference"]).read_bytes(), "wav": (ROOT / plan["audio"]).read_bytes(),
        "audio_sha": plan["audio_sha256"], "pose": (ROOT / plan["pose"]).read_bytes(),
        "pose_sha": plan["pose_sha256"], "frames_count": 64, "reference_sha": probe.REFERENCE_SHA,
        "prompt": plan["prompt"], "seed": probe.SEED}
    requests = [dict(request), dict(request)]
    probe.validate_batch(requests)
    return requests


def prepare():
    plan = expected_plan()
    requests_for(plan)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "plan.json"
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8")) != plan:
            raise ValueError("Existing experiment differs; preserve its evidence")
    else:
        conversation.save(path, plan)
    logger.info("Prepared two identical 3.95s takes; no credentials or GPU used. Budget allowance US$ %s", REQUIRED_USD)


def check_credit(value):
    if value is None:
        raise ValueError("Current remaining credit must be supplied before cloud inference")
    credit = Decimal(str(value))
    if not credit.is_finite() or not 0 <= credit <= 30 or credit < REQUIRED_USD:
        raise ValueError("Insufficient or invalid confirmed remaining Starter credit")
    return credit


def take_stream(stream, index):
    for item in stream:
        if item.get("take") != index:
            raise ValueError("Unexpected batch take order")
        if item["kind"] == "take_end":
            return
        yield {key: value for key, value in item.items() if key != "take"}
    raise ValueError("Missing take completion marker")


def verify_report(report, plan, index):
    fixed = {**plan["fixed"], "input_audio_sha256": plan["audio_sha256"],
        "pose_sha256": plan["pose_sha256"], "acting_prompt": plan["prompt"],
        "model_reused": index == 1, "model_retained_for_batch": True,
        "audio_conditioned": True, "pose_conditioned": True, "output_frames": 237,
        "width": 704, "height": 1280, "audio_offset_seconds": 0, "init_first_frame": True,
        "generation_settings": plan["generation_settings"], "negative_prompt": plan["negative_prompt"]}
    if any(report.get(key) != value for key, value in fixed.items()):
        raise ValueError("Worker changed inputs, quality parameters or reuse order")
    sha = report.get("raw_native_rgb_sha256", "")
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("Worker must fingerprint all native RGB frames")


def audit():
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    requests_for(plan)
    with wave.open(str(ROOT / plan["audio"])) as audio:
        reference = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
    reports = []
    for index in range(2):
        folder = OUT / str(index)
        report = json.loads((folder / "qa.json").read_text(encoding="utf-8"))
        verify_report(report, plan, index)
        checks = {}
        for name, fps, count in (("native", 16, 64), ("fluid", 60, 237)):
            path = folder / f"{name}.mp4"
            if digest(path.read_bytes()) != report["outputs"][name]["sha256"]:
                raise ValueError("Received video changed after its checkpoint")
            checks[name] = auditor.audit(name, fps, count, reference, path=path)
        conversation.save(folder / "av-audit.json", checks)
        reports.append(report)
    batch = json.loads((OUT / "batch.json").read_text(encoding="utf-8"))
    if batch.get("takes") != 2 or not batch.get("model_released"):
        raise ValueError("Batch did not release its bounded model session")
    same_pixels = reports[0]["raw_native_rgb_sha256"] == reports[1]["raw_native_rgb_sha256"]
    summary = {"technical_qa_passed": True, "native_pixels_identical": same_pixels,
        "model_loading_seconds": [r["stage_seconds"]["model_loading"] for r in reports],
        "take_worker_entry_seconds": [r["worker_entry_seconds"] for r in reports],
        "measured_batch_seconds": batch["worker_batch_seconds"],
        "measured_batch_estimate_usd": float(RATE) * batch["worker_batch_seconds"],
        "cost_scope": batch["timing_scope"], "human_review_required": True,
        "quality_preserved_approved": False, "production_enabled": False, "published": False,
        "note": "Different RGB hashes block parity claims; equal hashes still do not replace artistic review or prove faster generation."}
    conversation.save(OUT / "comparison.json", summary)
    return summary


def run(available_credit=None):
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    requests = requests_for(plan)
    if (OUT / "comparison.json").exists():
        audit()
        logger.info("Completed benchmark verified; no cloud invocation")
        return
    if ((OUT / "failure.json").exists() or (OUT / "generation.lock.json").exists() or
            (OUT / "batch.json").exists() or any((OUT / str(i)).exists() for i in range(2))):
        raise ValueError("Existing reservation/partial evidence; inspect app before any new run, no automatic retry")
    credit = check_credit(available_credit)
    lock = OUT / "generation.lock.json"
    with lock.open("x", encoding="utf-8") as reservation:
        json.dump({"remaining_credit_usd_reported": str(credit), "reserved_allowance_usd": str(REQUIRED_USD),
            "balance_source": "operator's current dashboard, not live API verification", "max_new_gpu_calls": 1}, reservation)
    started, app_id = time.perf_counter(), None
    try:
        conversation.credentials()  # only the two Modal keys from .env.cloud
        with modal.enable_output(), probe.app.run():
            app_id = probe.app.app_id
            conversation.save(OUT / "running.json", {"modal_app_id": app_id})
            stream = iter(probe.speak_reuse_benchmark.remote_gen(requests))
            for index in range(2):
                folder = OUT / str(index)
                folder.mkdir()
                report = probe.receive_stream(take_stream(stream, index), folder, prefix="")
                verify_report(report, plan, index)
                conversation.save(folder / "qa.json", {**report, "modal_app_id": app_id})
            batch = next(stream, None)
            if batch is None or batch.get("kind") != "batch_report" or next(stream, None) is not None:
                raise ValueError("Missing/ambiguous final batch report")
            conversation.save(OUT / "batch.json", {**batch, "modal_app_id": app_id,
                "client_seconds": time.perf_counter()-started})
        audit()
        lock.unlink()  # this run owns the exclusive lock, complete verified evidence retained
    except Exception as exc:
        conversation.save(OUT / "failure.json", {"modal_app_id": app_id,
            "error_type": type(exc).__name__, "client_seconds": time.perf_counter()-started})
        raise


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--run", action="store_true")
    action.add_argument("--audit", action="store_true")
    parser.add_argument("--available-credit-usd", type=Decimal)
    args = parser.parse_args()
    if args.prepare:
        prepare()
    elif args.audit:
        audit()
    else:
        run(args.available_credit_usd)
