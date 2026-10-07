"""Bounded 4-take dialogue preview; reuses approved S2V shot, never publishes."""
import argparse
import hashlib
import importlib
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import time
import wave

import modal
import numpy as np
from story_motion_contract import validate_inputs, interpolation_schedule

probe = importlib.import_module("modal-speech-motion-probe")
auditor = importlib.import_module("audit-speech-motion-probe")
ROOT, OUT = probe.ROOT, probe.ROOT / "output/audio-driven-conversation"
logger = logging.getLogger("story-conversation")
RATE = .001097 + 4 * .0000131 + 64 * .00000222
CALL_LIMIT, SESSION_LIMIT = 2100, 7200
PREFIX = (
    "Cinematic stylized realistic 3D close-up of the exact adult fruit person in the reference. "
    "Speak the provided Portuguese audio with natural syllable timing, lips and jaw articulation. "
    "Only the sharp foreground face speaks; the other person remains a blurred silent shoulder. "
    "Maintain the dialogue axis, fruit skin, human facial proportions, hair, clothes, accessories, "
    "and realistic Brazilian street at golden hour. Stable camera, continuous restrained acting. "
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    temp = path.with_suffix(".part.json")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def credentials():
    found = set()
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key] = value.strip().strip("\"'")
            found.add(key)
    if len(found) != 2:
        raise ValueError("Both Modal credentials must be present in .env.cloud")


def previous_stopped():
    import sys
    credentials()
    first = json.loads((OUT / "06/qa.json").read_text(encoding="utf-8"))
    rows = json.loads(subprocess.check_output([sys.executable, "-m", "modal", "app", "list", "--json"], text=True, timeout=30))
    previous = next((row for row in rows if row["app_id"] == first["modal_app_id"]), None)
    if previous is None or previous["description"] != probe.app.name or previous["state"] != "stopped" or int(previous["tasks"]) != 0:
        raise ValueError("Sequential app must be verified stopped before parallel continuation")
    return previous


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    pilot = ROOT / "output/humanized-story-pilot"
    original = json.loads((pilot / "plan.json").read_text(encoding="utf-8"))
    cuts = {c["shot"]: c["audio_seconds"] for c in json.loads((pilot / "editing-cuts.json").read_text(encoding="utf-8"))["cuts"]}
    approved = json.loads((ROOT / "output/audio-driven-motion-probe/qa.json").read_text(encoding="utf-8"))
    shots = []
    for source in original["shots"]:
        if source["id"] not in {"06", "07", "08", "09"}:
            continue
        shot = dict(source)
        key = source["speaker"]  # replace old wide shot 06 with sole speaker close
        reference = original["references"][key]
        directory = OUT / source["id"]
        directory.mkdir(exist_ok=True)
        words = json.loads((ROOT / source["words"]).read_text(encoding="utf-8"))
        if max(w["offset_seconds"] + w["duration_seconds"] for w in words) + .15 > cuts[source["id"]] + .001:
            raise ValueError("Cut would remove a word")
        wav = directory / "voice.wav"
        if not wav.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / source["audio"]),
                "-af", f"atrim=end={cuts[source['id']]},apad=pad_dur=0.25", "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", str(wav)], check=True, timeout=30)
        shot.update(reference=reference, frames=64 if source["id"] == "07" else 80,
            seed=2000 + int(source["id"]), prompt=probe.PROMPT if source["id"] == "07" else PREFIX + source["acting"],
            audio=str(wav.relative_to(ROOT)), audio_sha256=digest(wav.read_bytes()), word_boundaries=words,
            reused=source["id"] == "07")
        shot["audio_seconds"] = validate_inputs((ROOT / reference["path"]).read_bytes(), wav.read_bytes(),
            shot["audio_sha256"], frames=shot["frames"], reference_sha=reference["sha256"])
        shot["output_frames"] = len(list(interpolation_schedule(shot["frames"], 16, 60)))
        shot["clip_seconds"] = shot["output_frames"] / 60
        if shot["reused"]:
            if shot["audio_sha256"] != approved["input_audio_sha256"]:
                raise ValueError("Reuse audio differs from approved generation")
            for name in ("native", "fluid"):
                existing = ROOT / f"output/audio-driven-motion-probe/malu-{name}.mp4"
                if digest(existing.read_bytes()) != approved["outputs"][name]["sha256"]:
                    raise ValueError("Approved video changed")
                shutil.copyfile(existing, directory / f"{name}.mp4")
            save(directory / "qa.json", {**approved, "reused": True, "new_worker_seconds": 0,
                "human_sample_approved": True, "approval_scope": "operator approved short sample, not full conversation"})
        shots.append(shot)
    plan = {"title": "O biscoito e a desculpa", "shots": shots,
        "clip_seconds": sum(s["clip_seconds"] for s in shots), "database_writes": False, "published": False,
        "production_enabled": False, "new_gpu_calls": 3, "steps": 40,
        "worker_timeout_upper_estimate_usd": 3 * CALL_LIMIT * RATE,
        "budget_scope": "worker only, not invoice; provider spend cap remains $0, usage cap $30"}
    if not 15 <= plan["clip_seconds"] <= 20:
        raise ValueError("Conversation does not fit requested duration")
    save(OUT / "plan.json", plan)
    logger.info("Prepared %.2fs, one approved clip reused, three bounded new calls", plan["clip_seconds"])


def checked(shot):
    folder = OUT / shot["id"]
    auditor.OUT = folder  # keep contact sheets beside each take, preserve the approved sample
    report = json.loads((folder / "qa.json").read_text(encoding="utf-8"))
    if report["input_audio_sha256"] != shot["audio_sha256"] or report["reference_sha256"] != shot["reference"]["sha256"]:
        raise ValueError("Checkpoint inputs differ")
    if report["seed"] != shot["seed"] or report["steps"] != 40 or report["native_frames"] != shot["frames"]:
        raise ValueError("Checkpoint generation differs")
    if not shot["reused"] and report.get("acting_prompt") != shot["prompt"]:
        raise ValueError("Checkpoint direction differs")
    with wave.open(str(ROOT / shot["audio"])) as audio:
        voice = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
    results = {}
    for name, fps, count in (("native", 16, shot["frames"]), ("fluid", 60, shot["output_frames"])):
        path = folder / f"{name}.mp4"
        if digest(path.read_bytes()) != report["outputs"][name]["sha256"]:
            raise ValueError("Checkpoint video differs")
        results[name] = auditor.audit(name, fps, count, voice, path=path)
    save(folder / "av-audit.json", results)


def prepare_guided_review():
    """Re-edit the approved conversation with existing guided acting; zero cloud calls."""
    baseline = ROOT / "output/audio-driven-conversation"
    guided = ROOT / "output/arm-gesture-motion-probe"
    if OUT == baseline or OUT == guided or OUT.exists():
        raise ValueError("Review must use a new isolated folder; preserve previous evidence")
    plan = json.loads((baseline / "plan.json").read_text(encoding="utf-8"))
    assembly = json.loads((baseline / "assembly.json").read_text(encoding="utf-8"))
    review = json.loads((baseline / "operator-review.json").read_text(encoding="utf-8"))
    if (review.get("video_sha256") != assembly["sha256"] or review.get("appearance") != "approved" or
            review.get("dialogue_sync") != "approved_by_operator_after_playback" or
            digest((baseline / assembly["filename"]).read_bytes()) != assembly["sha256"] or
            [s["id"] for s in plan["shots"]] != ["06", "07", "08", "09"] or
            plan["published"] or plan["database_writes"] or plan["production_enabled"]):
        raise ValueError("Unchanged reviewed conversation required")
    sources = []
    for shot in plan["shots"]:
        source = guided if shot["id"] == "07" else baseline / shot["id"]
        report = json.loads((source / "qa.json").read_text(encoding="utf-8"))
        if (report["input_audio_sha256"] != shot["audio_sha256"] or
                digest((ROOT / shot["audio"]).read_bytes()) != shot["audio_sha256"] or
                report["reference_sha256"] != shot["reference"]["sha256"] or
                report["seed"] != shot["seed"] or report["steps"] != probe.STEPS or
                report["model_revision"] != probe.MODEL_REVISION or report["wan_commit"] != probe.WAN_COMMIT or
                report["native_frames"] != shot["frames"] or report["output_frames"] != shot["output_frames"] or
                report["native_fps"] != 16 or report["output_fps"] != 60 or
                (shot["id"] != "07" and report.get("acting_prompt") != shot["prompt"])):
            raise ValueError("Reused shot differs from the dialogue contract")
        validate_inputs((ROOT / shot["reference"]["path"]).read_bytes(), (ROOT / shot["audio"]).read_bytes(),
            shot["audio_sha256"], frames=shot["frames"], reference_sha=shot["reference"]["sha256"])
        if shot["id"] == "07":
            if (not report.get("pose_conditioned") or report["acting_prompt"] != probe.STABLE_HANDS_PROMPT or
                    digest((guided / "voice.wav").read_bytes()) != shot["audio_sha256"]):
                raise ValueError("Replacement must retain the exact original dialogue with guided acting")
            probe.validate_pose((guided / "pose.mp4").read_bytes(), report["pose_sha256"], shot["frames"])
            shot["prompt"] = report["acting_prompt"]
            shot["pose_sha256"] = report["pose_sha256"]
        for name in ("native", "fluid"):
            filename = f"malu-{name}.mp4" if shot["id"] == "07" else f"{name}.mp4"
            if digest((source / filename).read_bytes()) != report["outputs"][name]["sha256"]:
                raise ValueError("Reused video fingerprint changed")
        sources.append((shot, source, report))
    # All original inputs/checkpoints verified before creating the new review directory.
    OUT.mkdir()
    for shot, source, report in sources:
        folder = OUT / shot["id"]
        folder.mkdir()
        for name in ("native", "fluid"):
            filename = f"malu-{name}.mp4" if shot["id"] == "07" else f"{name}.mp4"
            shutil.copyfile(source / filename, folder / f"{name}.mp4")
        shot.update(reused=True, source_directory=str(source.relative_to(ROOT)))
        save(folder / "qa.json", {**report, "reused": True, "new_worker_seconds": 0,
            "source_directory": shot["source_directory"], "human_sample_approved": False,
            "approval_scope": "new edit requires operator review; previous approval not transferred"})
        checked(shot)
    plan.update(new_gpu_calls=0, worker_timeout_upper_estimate_usd=0,
        budget_scope="local reuse/edit only, no new Modal/TTS/image requests",
        review_variant="existing-arm-gesture-in-conversation", source_conversation_sha256=assembly["sha256"],
        production_enabled=False, human_review_required=True)
    save(OUT / "plan.json", plan)
    logger.info("Prepared four reused takes with guided shot 07; no credentials or cloud calls")


def run(selected=None):
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    suffix = f"-{selected}" if selected else ""
    failure = OUT / f"failure{suffix}.json"
    state = OUT / f"run-state{suffix}.json"
    if (OUT / "failure.json").exists() or failure.exists():
        raise ValueError("Previous failure requires inspection; no automatic retries")
    if [s["id"] for s in plan["shots"]] != ["06", "07", "08", "09"] or plan["published"] or plan["database_writes"]:
        raise ValueError("Unbounded or non-isolated plan")
    pending = []
    for shot in plan["shots"]:
        validate_inputs((ROOT / shot["reference"]["path"]).read_bytes(), (ROOT / shot["audio"]).read_bytes(),
            shot["audio_sha256"], frames=shot["frames"], reference_sha=shot["reference"]["sha256"])
        if selected is not None and shot["id"] in {"08", "09"} and shot["id"] != selected:
            continue  # the other isolated client owns this take, including partial files
        if (OUT / shot["id"] / "qa.json").exists():
            checked(shot)
        else:
            if any((OUT / shot["id"] / f"{name}.mp4").exists() for name in ("native", "fluid")):
                raise ValueError("Output without checkpoint; inspect before regenerating")
            if selected is None or selected == shot["id"]:
                pending.append(shot)
    if not pending:
        logger.info("All verified takes exist; no cloud invocation")
        return
    if selected in {"08", "09"}:
        previous_stopped()
    credentials()
    if any((OUT / shot["id"] / "generation.lock.json").exists() for shot in pending):
        raise ValueError("Take is reserved by another client; inspect lock/app, never retry automatically")
    started, app_id = time.perf_counter(), None
    completed = [s["id"] for s in plan["shots"] if (OUT / s["id"] / "qa.json").exists()]
    try:
        with modal.enable_output(), probe.app.run():
            app_id = probe.app.app_id
            for shot in pending:
                if time.perf_counter() - started + CALL_LIMIT + 180 > SESSION_LIMIT:
                    raise RuntimeError("Session reservation exhausted; completed takes preserved")
                folder = OUT / shot["id"]
                lock = folder / "generation.lock.json"
                with lock.open("x", encoding="utf-8") as reservation:
                    json.dump({"pid": os.getpid(), "modal_app_id": app_id, "shot": shot["id"]}, reservation)
                save(state, {"state": "generating", "current": shot["id"], "completed": completed,
                    "modal_app_id": app_id, "published": False, "production_enabled": False})
                logger.info("Generating %s: %s, 80 native frames, 40 steps", shot["id"], shot["speaker"])
                buffers, manifests, report = {}, {}, None
                for item in probe.speak.remote_gen((ROOT / shot["reference"]["path"]).read_bytes(),
                        (ROOT / shot["audio"]).read_bytes(), shot["audio_sha256"], frames_count=shot["frames"],
                        reference_sha=shot["reference"]["sha256"], prompt=shot["prompt"], seed=shot["seed"]):
                    if item["kind"] == "progress":
                        logger.info("Shot %s: %s", shot["id"], item["stage"])
                    elif item["kind"] == "report":
                        if report is not None:
                            raise ValueError("Duplicate report")
                        report = item["report"]
                    elif item["kind"] == "manifest":
                        name = item["name"]
                        if name not in {"native", "fluid"} or name in manifests or not 0 < item["size"] <= 30 * 1024 * 1024:
                            raise ValueError("Invalid manifest")
                        manifests[name], buffers[name] = item, bytearray()
                    elif item["kind"] == "chunk":
                        name = item["name"]
                        if name not in buffers or item["offset"] != len(buffers[name]) or len(item["data"]) > 128 * 1024:
                            raise ValueError("Invalid transport sequence")
                        buffers[name].extend(item["data"])
                        if len(buffers[name]) > manifests[name]["size"]:
                            raise ValueError("Oversized output")
                    else:
                        raise ValueError("Unknown response")
                if report is None or set(buffers) != {"native", "fluid"}:
                    raise ValueError("Incomplete generation")
                for name, data in buffers.items():
                    if len(data) != manifests[name]["size"] or digest(data) != manifests[name]["sha256"]:
                        raise ValueError("Checksum mismatch")
                    part = folder / f"{name}.part.mp4"
                    part.write_bytes(data)
                    subprocess.run(["ffmpeg", "-v", "error", "-i", str(part), "-f", "null", "-"], check=True, timeout=60)
                    part.replace(folder / f"{name}.mp4")
                save(folder / "qa.json", {**report, "outputs": manifests, "modal_app_id": app_id,
                    "new_worker_seconds": report["worker_seconds"], "human_sample_approved": False})
                checked(shot)
                lock.unlink()  # only our exact per-take reservation, after verified completion
                completed.append(shot["id"])
                logger.info("Shot %s verified; worker %.1fs", shot["id"], report["worker_seconds"])
        save(state, {"state": "clips_completed", "completed": completed,
            "modal_app_id": app_id, "published": False, "production_enabled": False})
    except Exception as exc:
        save(failure, {"modal_app_id": app_id, "error_type": type(exc).__name__,
            "completed": completed, "elapsed_seconds": time.perf_counter() - started})
        raise


def remaining_parallel():
    """Two isolated clients/apps, one call each; only after first take is saved."""
    import sys
    if not (OUT / "06/qa.json").exists():
        raise ValueError("First take must be secured before two-way continuation")
    if any((OUT / name).exists() for name in ("failure.json", "failure-08.json", "failure-09.json")):
        raise ValueError("Inspect prior failure before launching GPU calls")
    previous = previous_stopped()
    save(OUT / "sequential-session-ended.json", {"app": previous, "first_take_preserved": True,
        "reason": "Continue remaining two takes concurrently without duplicate inference"})
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    for shot in plan["shots"]:
        if shot["id"] in {"06", "07"}:
            checked(shot)
    children = []
    try:
        for selected in ("08", "09"):
            stream = (OUT / f"run-{selected}.log").open("w", encoding="utf-8")
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--run", "--shot", selected],
                stdout=stream, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            children.append((selected, child, stream))
        # Short individual polls permit external progress reporting/interruption.
        started = time.perf_counter()
        while any(child.poll() is None for _, child, _ in children):
            if time.perf_counter() - started > 3000:
                raise RuntimeError("Parallel client deadline reached; inspect apps before resuming")
            time.sleep(1)
        if any(child.returncode != 0 for _, child, _ in children):
            raise RuntimeError("Parallel take failed; preserve checkpoints, no retry")
        for shot in plan["shots"]:
            checked(shot)
        save(OUT / "run-state.json", {"state": "clips_completed", "completed": ["06", "07", "08", "09"],
            "max_parallel_new_calls": 2, "published": False, "production_enabled": False})
    finally:
        for _, child, stream in children:
            if child.poll() is None:
                # A terminated client may leave its app briefly alive: operator must inspect/stop it.
                child.terminate()
                child.wait(timeout=30)
            stream.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--prepare", action="store_true")
    choice.add_argument("--run", action="store_true")
    choice.add_argument("--remaining-parallel", action="store_true")
    choice.add_argument("--prepare-guided-review", action="store_true", help="Re-edit existing conversation with guided acting; no cloud calls")
    parser.add_argument("--shot", choices=("06", "08", "09"), help="One take per isolated client; 06 exits cleanly before parallel continuation")
    args = parser.parse_args()
    if args.shot and not args.run:
        parser.error("--shot requires --run")
    if args.prepare:
        prepare()
    elif args.prepare_guided_review:
        OUT = ROOT / "output/guided-acting-conversation"
        prepare_guided_review()
    elif args.remaining_parallel:
        remaining_parallel()
    else:
        run(args.shot)
