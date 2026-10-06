"""Render the local pilot shot-by-shot with verified, resumable files; no publishing."""
import argparse
import hashlib
import importlib
import json
import logging
import os
from pathlib import Path
import subprocess
import time

import modal

probe = importlib.import_module("modal-wan-probe")
ROOT, OUT = probe.ROOT, probe.ROOT / "output/humanized-story-pilot"
logger = logging.getLogger("story-pilot")
PREFIX = (
    "High-end cinematic stylized realistic 3D animation. Preserve the exact fruit characters, "
    "adult human proportions, face texture, hair, clothing, accessories, street and golden-hour "
    "lighting of the reference frame. Restrained believable acting, subtle breathing and fabric motion. "
    "Fixed camera, consistent anatomy, stable background. Keep the dialogue axis. "
)


def fingerprint(shot, reference):
    config = {"frames": shot["frames"], "seed": shot["seed"], "prompt": PREFIX + shot["acting"],
        "reference": reference["sha256"], "model": probe.MODEL, "revision": probe.REVISION,
        "steps": probe.STEPS, "width": probe.WIDTH, "height": probe.HEIGHT, "fps": probe.FPS, "version": 1}
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(), config


def write_json_atomic(path, data):
    temporary = path.with_suffix(".part.json")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--shots", help="Comma-separated shot IDs; default: all missing shots")
    args = parser.parse_args()
    if not args.run:
        parser.error("--run required with existing credit and $0 provider spend cap")
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key] = value.strip().strip("\"'")
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    if plan["publish"] or plan["database_writes"] or not 60 <= plan["measured_duration_seconds"] <= 180:
        raise ValueError("Invalid isolated episode plan")
    selected = set(args.shots.split(",")) if args.shots else {shot["id"] for shot in plan["shots"]}
    if not selected <= {shot["id"] for shot in plan["shots"]}:
        raise ValueError("Unknown shot ID")
    (OUT / "clips").mkdir(exist_ok=True)
    worker = probe.animate.with_options(gpu="H100")
    started = time.perf_counter()
    completed = []
    status_path = OUT / "generation-status.json"

    def status(state, **extra):
        write_json_atomic(status_path, {"state": state, "completed": completed, "selected": sorted(selected),
            "elapsed_seconds": time.perf_counter() - started, "database_writes": False, "published": False, **extra},
        )

    status("running")
    try:
        with modal.enable_output(), probe.app.run():
            app_id = probe.app.app_id
            for shot in plan["shots"]:
                if shot["id"] not in selected:
                    continue
                reference = plan["references"][shot["reference"]]
                png = (ROOT / reference["path"]).read_bytes()
                if hashlib.sha256(png).hexdigest() != reference["sha256"] or reference["sha256"] not in probe.APPROVED_INPUT_SHAS:
                    raise ValueError("Unapproved or modified reference")
                digest, config = fingerprint(shot, reference)
                output = OUT / "clips" / f"{shot['id']}.mp4"
                checkpoint = output.with_suffix(".json")
                if checkpoint.exists():
                    previous = json.loads(checkpoint.read_text(encoding="utf-8"))
                    if previous["fingerprint"] != digest or previous["report"]["negative_prompt"] != probe.NEGATIVE or \
                        not output.exists() or hashlib.sha256(output.read_bytes()).hexdigest() != previous["sha256"]:
                        raise ValueError("Checkpoint differs; preserve old files and review before another generation")
                    completed.append(shot["id"])
                    logger.info("Shot %s already verified; skipping", shot["id"])
                    continue
                if output.exists():
                    raise ValueError("Clip exists without a checkpoint; preserve it for review instead of regenerating")
                # Wall time includes cold starts and transfers. Leave headroom for a full
                # 900-second call plus startup; never launch unlimited automatic retries.
                if time.perf_counter() - started + 1020 > 7200:
                    raise RuntimeError("Pilot run budget reached; verified shots are preserved")
                logger.info("Generating shot %s, %d frames, reference=%s", shot["id"], shot["frames"], shot["reference"])
                status("running", current=shot["id"], modal_app_id=app_id)
                report, manifest, data = None, None, bytearray()
                for item in worker.remote_gen(png, {key: config[key] for key in ("frames", "seed", "prompt")}):
                    if item["kind"] == "report":
                        if report is not None:
                            raise RuntimeError("Duplicate report")
                        report = item["report"]
                    elif item["kind"] == "manifest":
                        if manifest is not None or not 0 < item["size"] <= 20 * 1024 * 1024:
                            raise RuntimeError("Invalid output manifest")
                        manifest = item
                    elif item["kind"] == "chunk":
                        if manifest is None or item["offset"] != len(data):
                            raise RuntimeError("Invalid stream sequence")
                        data.extend(item["data"])
                        if len(data) > manifest["size"]:
                            raise RuntimeError("Oversized output")
                    else:
                        raise RuntimeError("Unknown stream message")
                if not report or not manifest or len(data) != manifest["size"] or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
                    raise RuntimeError("Incomplete shot")
                partial = output.with_suffix(".part.mp4")
                partial.write_bytes(data)
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(partial), "-f", "null", "-"], check=True, capture_output=True, timeout=45)
                partial.replace(output)
                write_json_atomic(checkpoint, {"fingerprint": digest, "sha256": manifest["sha256"], "modal_app_id": app_id,
                    "report": report, "local_decode_verified": True})
                completed.append(shot["id"])
                logger.info("Shot %s saved, %.1fs worker, GPU=%s", shot["id"], report["worker_seconds"], report["gpu"])
                status("running", modal_app_id=app_id)
        status("completed", modal_app_id=app_id)
    except Exception as exc:
        status("failed", error_type=type(exc).__name__)
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
