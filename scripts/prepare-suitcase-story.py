"""Measured new-story preview with a credit floor; no episodes or publication."""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import importlib
import json
import logging
from pathlib import Path
import subprocess
import sys
import time
import wave

import modal
import numpy as np
import suitcase_story_contract as contract

probe = importlib.import_module("modal-speech-motion-probe")
conversation = importlib.import_module("render-story-conversation")
auditor = importlib.import_module("audit-speech-motion-probe")
ROOT, OUT = probe.ROOT, probe.ROOT / "output/suitcase-story-preview"
EDITORIAL = ROOT / "docs/stories/pilot-02-suitcase.json"
logger = logging.getLogger("suitcase-story")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    if (OUT / "plan.json").exists():
        preflight(); logger.info("Existing preparation verified; no TTS requests"); return
    plan = read(EDITORIAL)
    for name, expected in contract.IMAGE_HASHES.items():
        if sha(OUT / "references" / name) != expected:
            raise ValueError("Unreviewed image or changed continuity reference")
    for shot in plan["shots"]:
        folder = OUT / shot["id"]
        folder.mkdir(exist_ok=True)
        wav = folder / "voice.wav"
        words = []
        if shot["text"]:
            voice = "pt-BR-FranciscaNeural" if shot["speaker"] == "malu" else "pt-BR-AntonioNeural"
            mp3, bounds, cache = folder / "voice.mp3", folder / "words.json", folder / "tts-request.json"
            request = {"text": shot["text"], "voice": voice, "rate": "+0%",
                "audio": str(mp3), "boundaries": str(bounds)}
            if not (mp3.exists() and bounds.exists() and cache.exists() and read(cache) == request):
                if any(p.exists() for p in (mp3, bounds, cache)):
                    raise ValueError("Partial or changed TTS requires inspection, no overwrite/retry")
                subprocess.run([sys.executable, str(ROOT / "scripts/synthesize-edge.py")],
                    input=json.dumps(request).encode("utf-8"), check=True, timeout=90)
                conversation.save(cache, request)
            words = read(bounds)
            end = max(w["offset_seconds"] + w["duration_seconds"] for w in words)
            if not wav.exists():
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-af",
                    f"atrim=end={end},apad=pad_dur={shot['tail_seconds']}", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", str(wav)], check=True, timeout=30)
            shot["voice"] = voice
        elif not wav.exists():
            with wave.open(str(wav), "wb") as silence:
                silence.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                silence.writeframes(b"\0\0" * round(shot["seconds"] * 16000))
        with wave.open(str(wav)) as audio:
            seconds = audio.getnframes() / audio.getframerate()
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError("Dialogue format changed")
        reference = OUT / "references" / shot["image"]
        shot.update(audio=str(wav.relative_to(ROOT)), audio_sha256=sha(wav), audio_seconds=seconds,
            word_boundaries=words, reference={"path": str(reference.relative_to(ROOT)), "sha256":sha(reference),
                "source":"system", "origin":"session_imagegen", "license":"generated"})
        if shot.get("fallback_image"):
            fallback = OUT / "references" / shot["fallback_image"]
            shot["fallback_reference"] = {"path":str(fallback.relative_to(ROOT)), "sha256":sha(fallback)}
        if shot["kind"] == "animated_candidate":
            shot.update(frames=64, output_frames=237, prompt=contract.PROMPTS[shot["id"]])
            probe.validate_request(reference.read_bytes(), wav.read_bytes(), shot["audio_sha256"],
                reference_sha=sha(reference), frames_count=64, prompt=shot["prompt"], seed=shot["seed"])
        logger.info("Shot %s %s %.3fs", shot["id"], shot["kind"], seconds)
    seconds = sum(np.ceil(s["audio_seconds"] * 60) / 60 for s in plan["shots"])
    if not 15 <= seconds <= 20:
        raise ValueError(f"Measured story outside 15–20s: {seconds}; revise editorial timing before cloud")
    plan.update(measured_seconds=float(seconds), review_variant="suitcase-story-v1",
        generation_settings=dict(probe.GENERATION_SETTINGS), negative_prompt=probe.NEGATIVE,
        worker_timeout_seconds=contract.TIMEOUT, worker_rate_usd_per_second=str(contract.RATE),
        overhead_allowance_usd=str(contract.OVERHEAD), keep_credit_usd=str(contract.KEEP_CREDIT),
        max_new_gpu_calls=2, model_revision=probe.MODEL_REVISION)
    conversation.save(OUT / "plan.json", plan)
    preflight()


def preflight():
    plan, editorial = read(OUT / "plan.json"), read(EDITORIAL)
    if ([s["id"] for s in plan["shots"]] != ["01","02","03","04","05","06"] or
            plan["published"] or plan["production_enabled"] or plan["database_writes"] or
            plan["review_variant"] != "suitcase-story-v1" or plan["generation_settings"] != probe.GENERATION_SETTINGS or
            plan["negative_prompt"] != probe.NEGATIVE or plan["worker_timeout_seconds"] != contract.TIMEOUT):
        raise ValueError("Changed or unbounded editorial contract")
    for shot, original in zip(plan["shots"], editorial["shots"], strict=True):
        if any(shot.get(k) != original.get(k) for k in ("id","text","speaker","image","fallback_image","kind","seed")):
            raise ValueError("Changed story/direction")
        ref, wav = ROOT / shot["reference"]["path"], ROOT / shot["audio"]
        if sha(ref) != contract.IMAGE_HASHES[shot["image"]] or sha(wav) != shot["audio_sha256"]:
            raise ValueError("Changed owned image or dialogue")
        if shot.get("fallback_image"):
            fallback = shot["fallback_reference"]
            if (fallback["path"] != str(Path("output/suitcase-story-preview/references") / shot["fallback_image"]) or
                    fallback["sha256"] != contract.IMAGE_HASHES[shot["fallback_image"]] or
                    sha(ROOT / fallback["path"]) != fallback["sha256"]):
                raise ValueError("Unreviewed offscreen cover image")
        if shot["kind"] == "animated_candidate":
            if (shot["prompt"] != contract.PROMPTS[shot["id"]] or shot["frames"] != 64 or shot["output_frames"] != 237):
                raise ValueError("Altered acting or frame budget")
            probe.validate_request(**request_for(shot))
    return plan


def request_for(shot):
    return {"png": (ROOT / shot["reference"]["path"]).read_bytes(), "wav": (ROOT / shot["audio"]).read_bytes(),
        "audio_sha":shot["audio_sha256"], "reference_sha":shot["reference"]["sha256"],
        "frames_count":64, "prompt":shot["prompt"], "seed":shot["seed"]}


def verify(shot, report):
    expected = {"input_audio_sha256":shot["audio_sha256"], "reference_sha256":shot["reference"]["sha256"],
        "seed":shot["seed"], "acting_prompt":shot["prompt"], "steps":40,
        "native_frames":64, "native_fps":16, "output_frames":237, "output_fps":60,
        "width":704, "height":1280, "audio_conditioned":True, "pose_conditioned":False,
        "model_revision":probe.MODEL_REVISION, "wan_commit":probe.WAN_COMMIT,
        "generation_settings":probe.GENERATION_SETTINGS, "negative_prompt":probe.NEGATIVE,
        "rife_weights_sha256":probe.RIFE_SHA, "model_reused":False, "gpu_name":"NVIDIA H200"}
    if any(report.get(k) != v for k,v in expected.items()):
        raise ValueError("Worker changed the voice/identity/model/quality contract")


def audit_take(shot):
    folder = OUT / shot["id"]
    report = read(folder / "qa.json")
    verify(shot, report)
    with wave.open(str(ROOT / shot["audio"])) as wav:
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float64)
    results = {}
    for name,fps,count in (("native",16,64),("fluid",60,237)):
        path = folder / f"{name}.mp4"
        if sha(path) != report["outputs"][name]["sha256"]:
            raise ValueError("Completed clip changed")
        results[name] = auditor.audit(name,fps,count,samples,path=path)
    conversation.save(folder / "av-audit.json", results)


def run(credit, credit_source="operator_dashboard"):
    plan = preflight()
    lock, failed = OUT / "generation.lock.json", OUT / "failure.json"
    if lock.exists() or failed.exists():
        raise ValueError("Reserved or failed run requires inspection; never automatic retry")
    for shot in plan["shots"]:
        folder = OUT / shot["id"]
        if not (folder / "qa.json").exists() and any((folder/f"{n}.mp4").exists() for n in ("native","fluid")):
            raise ValueError("Partial output requires inspection")
    if (OUT / "cloud-selection.json").exists():
        selection = read(OUT / "cloud-selection.json")
        selected = [s for s in plan["shots"] if s["id"] in selection["selected"]]
        if not all((OUT/s["id"]/"qa.json").exists() for s in selected):
            raise ValueError("Existing allocation cannot be silently relaunched")
        for shot in selected: audit_take(shot)
        logger.info("Completed allocation verified; no cloud calls"); return
    if credit_source not in ("operator_dashboard", "modal_billing_cli_conservative"):
        raise ValueError("Unknown current-credit provenance")
    count = contract.affordable_takes(credit)
    selected = [s for s in plan["shots"] if s["id"] in ("02","05")][:count]
    selection = {"selected":[s["id"] for s in selected], "reported_current_credit_usd":str(credit),
        "max_new_gpu_calls":count, "reserved_allowance_usd":str(contract.reserve(count)) if count else "0",
        "keep_credit_planned_usd":str(contract.KEEP_CREDIT), "balance_source":credit_source,
        "automatic_retry":False, "production_enabled":False, "published":False}
    conversation.save(OUT / "cloud-selection.json", selection)
    if count == 0:
        logger.info("Credit floor protects balance: keep the complete local animatic, no cloud calls"); return
    with lock.open("x", encoding="utf-8") as f: json.dump(selection,f)
    app_id, started = None, time.perf_counter()
    try:
        conversation.credentials()
        rows = json.loads(subprocess.check_output([sys.executable,"-X","utf8","-m","modal","app","list","--json"],text=True,timeout=30))
        active = [r for r in rows if r["state"] != "stopped" and int(r["tasks"]) > 0]
        conversation.save(OUT/"modal-preflight.json", {"active_apps":active,"checked_before_generation":True})
        if active:
            raise ValueError("Concurrent account workloads make the small credit reservation uncertain; inspect before cloud generation")
        for shot in selected:
            with modal.enable_output(), probe.app.run():
                app_id = probe.app.app_id
                conversation.save(OUT / "running.json", {"modal_app_id":app_id,"shot":shot["id"]})
                report = probe.receive_stream(probe.speak_suitcase.remote_gen(**request_for(shot)), OUT/shot["id"], prefix="")
                verify(shot, report)
                conversation.save(OUT/shot["id"]/"qa.json", {**report,"modal_app_id":app_id,
                    "new_worker_seconds":report["worker_entry_seconds"],
                    "new_worker_estimate_usd":float(contract.RATE)*report["worker_entry_seconds"],
                    "human_review_pending":True})
            audit_take(shot)
            rows = json.loads(subprocess.check_output([sys.executable,"-X","utf8","-m","modal","app","list","--json"],text=True,timeout=30))
            row = next((r for r in rows if r["app_id"]==app_id),None)
            if row is None or row["description"] != probe.app.name or row["state"] != "stopped" or int(row["tasks"]) != 0:
                raise ValueError("Previous app must be stopped before another sequential take")
            conversation.save(OUT/shot["id"]/"modal-final-state.json",row)
        conversation.save(OUT/"execution-summary.json", {**selection,"client_seconds":time.perf_counter()-started,
            "completed_takes":count,"worker_estimate_usd":sum(read(OUT/s["id"]/"qa.json")["new_worker_estimate_usd"] for s in selected),
            "cost_scope":"measured completed worker only; not invoice or live balance; overhead unmeasured",
            "all_apps_stopped_zero_tasks":True,"human_review_pending":True})
        lock.unlink()
    except Exception as exc:
        conversation.save(failed,{"modal_app_id":app_id,"error_type":type(exc).__name__,"client_seconds":time.perf_counter()-started})
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--prepare",action="store_true"); actions.add_argument("--run",action="store_true")
    actions.add_argument("--audit",action="store_true")
    parser.add_argument("--available-credit-usd",type=Decimal)
    parser.add_argument("--credit-source", choices=("operator_dashboard", "modal_billing_cli_conservative"), default="operator_dashboard")
    args = parser.parse_args()
    if args.prepare: prepare()
    elif args.run: run(args.available_credit_usd, args.credit_source)
    else:
        for shot in preflight()["shots"]:
            if (OUT/shot["id"]/"qa.json").exists(): audit_take(shot)
