"""One cloud audio-driven close, native and RIFE versions. No episode/publication.

python scripts/modal-speech-motion-probe.py --prepare
python scripts/modal-speech-motion-probe.py --run
"""
from __future__ import annotations
import argparse
import gc
import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import time

import modal
from story_video_engine import ModelSession, generate_speech as engine_generate_speech, STEPS, SEED, MAX_AREA, GENERATION_SETTINGS, NEGATIVE
from story_video_weights import MODEL, MODEL_REVISION, WAN_COMMIT, RIFE_COMMIT, RIFE_REVISION, RIFE_SHA, FLASH_WHEEL
from story_video_image import image as production_image
from story_motion_contract import FRAMES, NATIVE_FPS, OUTPUT_FPS, REFERENCE_SHA, validate_inputs, interpolation_schedule
import suitcase_story_contract as suitcase_contract

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/audio-driven-motion-probe"
PROMPT = (
    "A cinematic stylized realistic 3D close-up of the exact adult apple woman in the reference, "
    "speaking the provided Portuguese dialogue to the man out of focus on the right. Her lips and jaw "
    "articulate each spoken syllable with natural timing. She is incredulous about the missing biscuit: "
    "raises one eyebrow, then gives an expressive brief questioning head tilt, maintaining eye contact "
    "with the man. Subtle breathing and a small hand gesture at chest level. Preserve her red apple "
    "skin texture, adult human facial proportions, chestnut wavy hair, gold earrings, floral cream "
    "dress and the realistic Brazilian street at golden hour. Only the woman speaks, the man remains "
    "a blurred silent foreground shoulder. Stable camera, continuous coherent fluid acting."
)
EXPRESSIVE_PROMPT = (
    "Cinematic stylized realistic 3D medium close-up of the exact adult apple woman in the reference, "
    "speaking the provided Portuguese dialogue to the man blurred on the right. Preserve her identity, "
    "apple skin, chestnut wavy hair, gold earrings, floral cream dress, and golden-hour Brazilian street. "
    "Her lips and jaw articulate the actual audio; her face stays unobstructed and directed toward him. "
    "Play an incredulous comic confrontation with a clear progression, not a held pose. "
    "During the question 'Voce protegeu o biscoito com a boca?', she leans her upper body toward him, "
    "raises her eyebrows, and moves the already visible open palm outward toward him in one deliberate "
    "questioning gesture. Her shoulder and elbow follow the hand naturally, fingers relaxed. "
    "Between sentences she draws that hand back toward her torso, briefly narrowing her eyes at him. "
    "On 'Era um presente!', she straightens, gives one emphatic palm-up beat from the elbow and a "
    "small decisive head nod, conveying frustrated disbelief, then lets her shoulders and hand settle. "
    "Keep the other hand at her waist. Hair and dress follow her body motion naturally. "
    "Movement is visibly expressive, motivated by the words, smooth and anatomically coherent, "
    "with distinct preparation, action and recovery rather than constant waving. "
    "Only she speaks; the man stays a silent blurred foreground shoulder. Stable camera, continuous shot."
)
logger = logging.getLogger("speech-motion-probe")
STABLE_HANDS_PROMPT = (
    "Cinematic realistic stylized 3D dialogue of the exact adult apple woman in the reference. "
    "Preserve her apple face, chestnut wavy hair, gold earrings, floral cream dress and golden-hour street. "
    "Speak the provided Portuguese audio with accurate lip and jaw timing, looking at the silent blurred man. "
    "Follow the supplied body and hand pose guide. Her waist hand stays resting at the waist. "
    "The visible palm stays open in the reference orientation with the same five relaxed fingers, "
    "moving only gently together with the elbow. Preserve hand shape, finger lengths and spacing throughout. "
    "Act through her face and upper body: a questioning eyebrow lift and slight forward lean during "
    "the question, a brief incredulous look between sentences, then an emphatic small head nod and "
    "shoulder response on 'Era um presente!', settling afterwards. Keep both hands below the face. "
    "Natural continuous motion, no wrist twisting, no finger curling, no raised hands beside the head, "
    "no crossing arms, no abrupt jumps. The camera stays stable and the other person remains silent."
)


def validate_pose(data, expected_sha, frames=FRAMES):
    """Reject partial/retimed pose guides before allocating GPU and again in worker."""
    import tempfile
    if not isinstance(data, bytes) or not 100 < len(data) <= 2 * 1024 * 1024:
        raise ValueError("Invalid bounded pose guide size")
    if hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError("Pose guide fingerprint mismatch")
    with tempfile.TemporaryDirectory(prefix="pose-preflight-") as directory:
        path = Path(directory) / "pose.mp4"
        path.write_bytes(data)
        streams = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames",
            "-show_streams", "-of", "json", str(path)], timeout=30))["streams"]
        if len(streams) != 1:
            raise ValueError("Pose guide must contain video only")
        stream = streams[0]
        if (stream["codec_type"], stream["codec_name"], stream["width"], stream["height"],
                stream["avg_frame_rate"], int(stream["nb_read_frames"])) != ("video", "h264", 704, 1280, "16/1", frames):
            raise ValueError("Pose guide must match native shape, FPS and coverage")
        if abs(float(stream.get("start_time", 0))) > .001:
            raise ValueError("Pose guide must start at zero")
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True, timeout=30)


image = production_image.add_local_file(ROOT / "scripts/story_motion_contract.py", "/root/story_motion_contract.py", copy=True).add_local_file(ROOT / "scripts/suitcase_story_contract.py", "/root/suitcase_story_contract.py", copy=True)
app = modal.App("content-ai-audio-driven-motion-probe")


def validate_request(png, wav, audio_sha, *, frames_count=FRAMES,
                     reference_sha=REFERENCE_SHA, prompt=PROMPT, seed=SEED, pose=None, pose_sha=None):
    """Shared local/worker preflight; no model allocation or credential access."""
    seconds = validate_inputs(png, wav, audio_sha, frames=frames_count, reference_sha=reference_sha)
    if (pose is None) != (pose_sha is None):
        raise ValueError("Pose data and fingerprint must be provided together")
    if pose is not None:
        validate_pose(pose, pose_sha, frames_count)
    if not isinstance(prompt, str) or not 100 <= len(prompt) <= 2000 or type(seed) is not int or not 0 <= seed <= 10000:
        raise ValueError("Invalid bounded acting direction")
    return seconds


def validate_batch(requests):
    if not isinstance(requests, (list, tuple)) or len(requests) != 2:
        raise ValueError("Benchmark requires exactly two bounded takes")
    fields = {"png", "wav", "audio_sha", "reference_sha", "frames_count", "prompt", "seed", "pose", "pose_sha"}
    for request in requests:
        if not isinstance(request, dict) or set(request) != fields or request["frames_count"] != FRAMES:
            raise ValueError("Benchmark accepts complete 64-frame requests only")
        validate_request(**request)
    if requests[0] != requests[1]:
        raise ValueError("Reuse benchmark must hold all artistic inputs identical")


def generate_speech(png: bytes, wav: bytes, audio_sha: str, *, frames_count=FRAMES,
                    reference_sha=REFERENCE_SHA, prompt=PROMPT, seed=SEED, pose=None, pose_sha=None,
                    model_session=None):
    # Legacy auditions retain their original approved-reference allowlist.
    validate_request(png, wav, audio_sha, frames_count=frames_count,
        reference_sha=reference_sha, prompt=prompt, seed=seed, pose=pose, pose_sha=pose_sha)
    yield from engine_generate_speech(png, wav, audio_sha, frames_count=frames_count,
        reference_sha=reference_sha, prompt=prompt, seed=seed, pose=pose, pose_sha=pose_sha,
        model_session=model_session)


@app.function(image=image, gpu="H100", cpu=(4, 4), memory=(65536, 65536),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=2100, startup_timeout=180, restrict_modal_access=True, block_network=True,
    is_generator=True)
def speak(png: bytes, wav: bytes, audio_sha: str, *, frames_count=FRAMES,
          reference_sha=REFERENCE_SHA, prompt=PROMPT, seed=SEED, pose=None, pose_sha=None):
    yield from generate_speech(png, wav, audio_sha, frames_count=frames_count,
        reference_sha=reference_sha, prompt=prompt, seed=seed, pose=pose, pose_sha=pose_sha)


@app.function(image=image, gpu="H200", cpu=(4, 4), memory=(65536, 65536),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=2400, startup_timeout=180, restrict_modal_access=True, block_network=True,
    is_generator=True)
def speak_body_h200(png: bytes, wav: bytes, audio_sha: str, *, frames_count=80,
                    reference_sha=REFERENCE_SHA, prompt=PROMPT, seed=SEED, pose=None, pose_sha=None):
    """Isolated healthy-hardware recovery route; preserves the existing sampler/settings."""
    if frames_count != 80 or pose is None:
        raise ValueError("Body-acting recovery requires the bounded 80-frame pose experiment")
    yield from generate_speech(png, wav, audio_sha, frames_count=frames_count,
        reference_sha=reference_sha, prompt=prompt, seed=seed, pose=pose, pose_sha=pose_sha)


@app.function(image=image, gpu="H200", cpu=(4, 4), memory=(65536, 65536),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=1800, startup_timeout=180, restrict_modal_access=True, block_network=True,
    is_generator=True)
def speak_suitcase(png: bytes, wav: bytes, audio_sha: str, *, frames_count=64,
                   reference_sha=None, prompt=None, seed=None, pose=None, pose_sha=None):
    expected = {suitcase_contract.REFERENCE_HASHES["malu-entryway-v1.png"]:
        (3002, suitcase_contract.PROMPTS["02"]),
        suitcase_contract.REFERENCE_HASHES["laranjito-entryway-v1.png"]:
        (3005, suitcase_contract.PROMPTS["05"])}
    if frames_count != 64 or pose is not None or pose_sha is not None or expected.get(reference_sha) != (seed, prompt):
        raise ValueError("Only the two bounded new-story takes; no reused pose or arbitrary direction")
    yield from generate_speech(png, wav, audio_sha, frames_count=64,
        reference_sha=reference_sha, prompt=prompt, seed=seed)


@app.function(image=image, gpu="H100", cpu=(4, 4), memory=(65536, 65536),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=4200, startup_timeout=180, restrict_modal_access=True, block_network=True,
    is_generator=True)
def speak_reuse_benchmark(requests):
    validate_batch(requests)  # check the entire batch before loading any weights
    session = ModelSession()
    started = time.perf_counter()
    try:
        for index, request in enumerate(requests):
            for item in generate_speech(**request, model_session=session):
                yield {**item, "take": index}
            yield {"kind": "take_end", "take": index}
    finally:
        session.close()  # also release after cancellation, exception or abandoned generator
        gc.collect()
        import torch
        torch.cuda.empty_cache()
    import resource
    yield {"kind": "batch_report", "takes": session.uses, "model_released": session.closed,
        "worker_batch_seconds": time.perf_counter()-started,
        "process_peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "production_enabled": False, "published": False,
        "timing_scope": "includes batch streaming/cleanup; excludes boot/build/idle and is not invoice"}


def receive_stream(items, directory, prefix="malu-"):
    """Verify bounded transport and decode before storing a reusable checkpoint."""
    results, manifests, report = {}, {}, None
    for item in items:
        if item["kind"] == "progress":
            logger.info("Stage: %s", item["stage"])
        elif item["kind"] == "report":
            if report is not None:
                raise ValueError("Duplicate worker report")
            report = item["report"]
        elif item["kind"] == "manifest":
            name = item["name"]
            if report is None or name not in {"native", "fluid"} or name in manifests or not 0 < item["size"] <= 30 * 1024 * 1024:
                raise ValueError("Invalid output manifest")
            manifests[name], results[name] = item, bytearray()
        elif item["kind"] == "chunk":
            name = item["name"]
            if name not in manifests or item["offset"] != len(results[name]) or not 0 < len(item["data"]) <= 128 * 1024:
                raise ValueError("Invalid transport sequence")
            results[name].extend(item["data"])
            if len(results[name]) > manifests[name]["size"]:
                raise ValueError("Oversized output")
        else:
            raise ValueError("Unknown worker response")
    if report is None or set(results) != {"native", "fluid"}:
        raise ValueError("Incomplete test")
    # Validate both checksums before writing either output.
    for name, data in results.items():
        if len(data) != manifests[name]["size"] or hashlib.sha256(data).hexdigest() != manifests[name]["sha256"]:
            raise ValueError("Output checksum mismatch")
    for name, data in results.items():
        temporary = directory / f"{name}.tmp.mp4"
        temporary.write_bytes(data)
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(temporary), "-f", "null", "-"], check=True, timeout=60)
        temporary.replace(directory / f"{prefix}{name}.mp4")
    return {**report, "outputs": manifests}


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    cuts = json.loads((ROOT / "output/humanized-story-pilot/editing-cuts.json").read_text(encoding="utf-8"))
    seconds = next(cut["audio_seconds"] for cut in cuts["cuts"] if cut["shot"] == "07")
    words = json.loads((ROOT / "output/humanized-story-pilot/audio/07.words.json").read_text(encoding="utf-8"))
    if max(word["offset_seconds"] + word["duration_seconds"] for word in words) + 0.15 > seconds:
        raise ValueError("Measured cut would truncate a word or its safety margin")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "output/humanized-story-pilot/audio/07.mp3"),
        "-af", f"atrim=end={seconds},apad=pad_dur=0.25", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        str(OUT / "voice.wav")], check=True, timeout=30)
    png = (ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes()
    wav = (OUT / "voice.wav").read_bytes()
    audio_sha = hashlib.sha256(wav).hexdigest()
    duration = validate_inputs(png, wav, audio_sha)
    (OUT / "input.json").write_text(json.dumps({"shot": "07", "text": "Você protegeu o biscoito com a boca? Era um presente!",
        "voice": "pt-BR-FranciscaNeural", "audio_seconds": duration, "audio_sha256": audio_sha,
        "source": "owned dialogue from pilot 01", "word_boundaries": words,
        "prompt": PROMPT, "negative_prompt": NEGATIVE, "no_new_tts_request": True}, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Prepared owned audio, %.3f seconds", duration)


def prepare_expressive(pose_controlled=False, arm_gesture=False):
    """Controlled acting comparison: same approved image, PCM, seed and model."""
    baseline = ROOT / ("output/stable-hands-motion-probe" if arm_gesture else "output/audio-driven-motion-probe")
    data = json.loads((baseline / "input.json").read_text(encoding="utf-8"))
    approved = json.loads((baseline / "qa.json").read_text(encoding="utf-8"))
    if arm_gesture:
        review=json.loads((baseline/"operator-review.json").read_text(encoding="utf-8"))
        if (not pose_controlled or not approved.get("pose_conditioned") or
            not review.get("movement_quality_accepted") or review.get("video_sha256")!=approved["outputs"]["fluid"]["sha256"] or
            data["prompt"]!=STABLE_HANDS_PROMPT):
            raise ValueError("Larger gesture requires the unchanged movement-approved pose baseline")
    fixed = {"seed": SEED, "steps": STEPS, "model": MODEL, "model_revision": MODEL_REVISION,
        "wan_commit": WAN_COMMIT, "rife_revision": RIFE_REVISION, "rife_weights_sha256": RIFE_SHA,
        "native_fps": NATIVE_FPS, "native_frames": FRAMES, "output_fps": OUTPUT_FPS}
    if any(approved.get(key) != value for key, value in fixed.items()) or data["negative_prompt"] != NEGATIVE:
        raise ValueError("Approved generation configuration differs; not an acting-only comparison")
    wav = (baseline / "voice.wav").read_bytes()
    if hashlib.sha256((baseline / "malu-fluid.mp4").read_bytes()).hexdigest() != approved["outputs"]["fluid"]["sha256"]:
        raise ValueError("Approved baseline video changed")
    if hashlib.sha256(wav).hexdigest() != approved["input_audio_sha256"]:
        raise ValueError("Approved baseline voice changed")
    validate_inputs((ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes(),
        wav, data["audio_sha256"])
    data.update(prompt=STABLE_HANDS_PROMPT if pose_controlled else EXPRESSIVE_PROMPT, negative_prompt=NEGATIVE,
        baseline_sha256=approved["outputs"]["fluid"]["sha256"],
        experiment="arm-gesture-pose-v2" if arm_gesture else "stable-hands-pose-v1" if pose_controlled else "acting-only-v1", seed=SEED, native_fps=NATIVE_FPS, output_fps=OUTPUT_FPS,
        max_new_gpu_calls=1, worker_timeout_seconds=2100,
        worker_timeout_upper_estimate_usd=2100 * (.001097 + 4 * .0000131 + 64 * .00000222),
        budget_scope="worker only; excludes build/startup/idle; not invoice or remaining balance",
        pose_conditioned=pose_controlled, production_enabled=False, published=False)
    if pose_controlled:
        pose = (OUT / "pose.mp4").read_bytes()
        geometry = json.loads((OUT / "pose-guide.json").read_text(encoding="utf-8"))
        if geometry["license"] != "own" or geometry["reference_sha256"] != REFERENCE_SHA:
            raise ValueError("Guide provenance must match the owned reference")
        data["pose_sha256"] = geometry["video_sha256"]
        validate_pose(pose, data["pose_sha256"])
        if arm_gesture and data["pose_sha256"]==approved["pose_sha256"]:
            raise ValueError("New gesture must use a different pose trajectory")
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "input.json"
    if (OUT / "voice.wav").exists() and (OUT / "voice.wav").read_bytes() != wav:
        raise ValueError("Existing experiment voice differs")
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8")) != data or not (OUT / "voice.wav").exists():
            raise ValueError("Existing experiment differs; preserve its inputs and outputs")
        logger.info("Existing acting experiment preserved; no inputs rewritten")
        return
    (OUT / "voice.wav").write_bytes(wav)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Prepared one acting-only comparison; original image, voice, seed and FPS retained")


def run(build_only=False, expressive=False, pose_controlled=False):
    png = (ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes()
    wav = (OUT / "voice.wav").read_bytes()
    inputs = json.loads((OUT / "input.json").read_text(encoding="utf-8"))
    expected = inputs["audio_sha256"]
    prompt = STABLE_HANDS_PROMPT if pose_controlled else EXPRESSIVE_PROMPT if expressive else PROMPT
    if inputs["prompt"] != prompt or inputs["negative_prompt"] != NEGATIVE or inputs.get("seed", SEED) != SEED:
        raise ValueError("Experiment direction differs from the reviewed manifest")
    validate_inputs(png, wav, expected)  # Reject before creating cloud app.
    pose = (OUT / "pose.mp4").read_bytes() if pose_controlled else None
    pose_sha = inputs.get("pose_sha256") if pose_controlled else None
    if inputs.get("pose_conditioned", False) != pose_controlled:
        raise ValueError("Pose experiment differs from manifest")
    if pose_controlled:
        validate_pose(pose, pose_sha)
    if (OUT / "qa.json").exists():
        raise ValueError("Completed test exists; do not spend credits regenerating silently")
    lock = OUT / "generation.lock.json"
    if (OUT / "failure.json").exists() or lock.exists():
        raise ValueError("Inspect previous failure/reservation; never retry automatically")
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key] = value.strip().strip("\"'")
    started, app_id = time.perf_counter(), None
    if not build_only:
        with lock.open("x", encoding="utf-8") as reservation:
            json.dump({"pid": os.getpid(), "experiment": inputs.get("experiment", "baseline"),
                "max_new_gpu_calls": 1}, reservation)
    try:
        with modal.enable_output(), app.run():
            app_id = app.app_id
            (OUT / "running.json").write_text(json.dumps({"modal_app_id": app_id}), encoding="utf-8")
            if build_only:
                logger.info("CPU image/dependency preparation complete; no GPU inference requested")
                return
            report = receive_stream(speak.remote_gen(png, wav, expected,
                prompt=prompt, pose=pose, pose_sha=pose_sha), OUT)
        report.update({"modal_app_id": app_id, "client_seconds": time.perf_counter() - started})
        (OUT / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if (OUT / "failure.json").exists():
            (OUT / "failure.json").replace(OUT / "preparation-failure.json")
        (OUT / "run-state.json").write_text(json.dumps({"status": "completed", "modal_app_id": app_id,
            "human_review_required": True, "production_enabled": False}), encoding="utf-8")
        lock.unlink()  # remove only this invocation's exclusive reservation after verified transport
        logger.info("Native and fluid audio-driven tests received: %s", OUT)
    except Exception as exc:
        (OUT / "failure.json").write_text(json.dumps({"modal_app_id": app_id, "error_type": type(exc).__name__,
            "elapsed_seconds": time.perf_counter() - started}), encoding="utf-8")
        raise


if __name__ == "__main__":
    # Rich emits Unicode checkmarks; Windows redirected stdout may default to cp1252.
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,"reconfigure"): stream.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--run", action="store_true")
    action.add_argument("--build-only", action="store_true")
    profile = parser.add_mutually_exclusive_group()
    profile.add_argument("--expressive", action="store_true", help="Isolated acting comparison, preserves approved baseline")
    profile.add_argument("--pose-controlled", action="store_true", help="Stable hands with owned pose guide and original audio")
    profile.add_argument("--arm-gesture", action="store_true", help="Larger guided elbow gesture against movement-approved pose baseline")
    arguments = parser.parse_args()
    if arguments.expressive:
        OUT = ROOT / "output/expressive-speech-motion-probe"
    if arguments.pose_controlled:
        OUT = ROOT / "output/stable-hands-motion-probe"
    if arguments.arm_gesture:
        OUT = ROOT / "output/arm-gesture-motion-probe"
    guided = arguments.pose_controlled or arguments.arm_gesture
    if arguments.prepare:
        prepare_expressive(guided, arguments.arm_gesture) if arguments.expressive or guided else prepare()
    else:
        run(build_only=arguments.build_only, expressive=arguments.expressive, pose_controlled=guided)
