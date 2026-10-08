"""Bounded transport, execution fingerprints and audiovisual output validation."""
import hashlib
import json
from pathlib import Path
import subprocess
from fractions import Fraction
from story_video_contract import SHA, NATIVE_FPS, OUTPUT_FPS, interpolation_schedule
from story_video_engine import MODEL, MODEL_REVISION, WAN_COMMIT, RIFE_REVISION, RIFE_SHA, GENERATION_SETTINGS, NEGATIVE

PROVIDER = "modal-wan-s2v-h100-v1"
APP_NAME = "content-ai-story-video"


def execution_hash():
    # Normalize line endings: checkout Windows/Linux must agree. Any engine,
    # validation or image change requires a new series compatibility approval.
    sources = {}
    for name in ("story_video_engine.py", "story_video_contract.py", "story_video_image.py", "story_video_runtime.py", "story_video_weights.py"):
        source = Path(__file__).with_name(name).read_text(encoding="utf-8").replace("\r\n", "\n")
        sources[name] = hashlib.sha256(source.encode()).hexdigest()
    contract = {"version": "1", "sources": sources, "gpu": "H100", "cpu": 4, "memory_mb": 65536,
        "frames": 64, "timeout_seconds": 2100, "startup_seconds": 180, "scaledown_seconds": 2,
        "orientation": "portrait", "output_fps": 60, "sdk": "1.6.1"}
    return hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_report(report, request):
    fixed = {"audio_conditioned": True, "lip_sync_validated": False, "human_review_required": True,
        "native_fps": NATIVE_FPS, "native_frames": 64, "output_fps": OUTPUT_FPS,
        "output_frames": len(list(interpolation_schedule(64, 16, 60))), "width": 704, "height": 1280,
        "model": MODEL, "model_revision": MODEL_REVISION, "wan_commit": WAN_COMMIT,
        "rife_revision": RIFE_REVISION, "rife_weights_sha256": RIFE_SHA, "steps": 40,
        "generation_settings": GENERATION_SETTINGS, "negative_prompt": NEGATIVE,
        "init_first_frame": True, "audio_offset_seconds": 0, "no_loop_no_speed_change": True,
        "reference_sha256": request["reference_sha"], "input_audio_sha256": request["audio_sha"],
        "pose_sha256": request.get("pose_sha"), "pose_conditioned": request.get("pose_sha") is not None,
        "acting_prompt": request["prompt"], "seed": request["seed"], "model_reused": False,
        "model_retained_for_batch": False}
    if not isinstance(report, dict) or len(json.dumps(report)) > 24000 or any(report.get(k) != v for k, v in fixed.items()):
        raise ValueError("Worker output differs from the approved execution contract")
    if not isinstance(report.get("raw_native_rgb_sha256"), str) or not SHA.fullmatch(report["raw_native_rgb_sha256"]):
        raise ValueError("Missing native-frame evidence")
    seconds = report.get("input_audio_seconds")
    if type(seconds) not in (int, float) or not 0 < seconds <= 63 / 16:
        raise ValueError("Invalid reported audio coverage")


def receive_outputs(items, request):
    """Verify every file before making either file available to the uploader."""
    report, manifests, outputs = None, {}, {}
    for item in items:
        kind = item.get("kind")
        if kind == "progress":
            continue
        if kind == "report":
            if report is not None or manifests:
                raise ValueError("Duplicate or late report")
            validate_report(item.get("report"), request)
            report = item["report"]
        elif kind == "manifest":
            name = item.get("name")
            size, sha = item.get("size"), item.get("sha256")
            if report is None or name not in {"native", "fluid"} or name in manifests or type(size) is not int or not 0 < size <= 30 * 1024 * 1024 or not isinstance(sha, str) or not SHA.fullmatch(sha):
                raise ValueError("Invalid output manifest")
            manifests[name], outputs[name] = item, bytearray()
        elif kind == "chunk":
            name, data = item.get("name"), item.get("data")
            if name not in manifests or item.get("offset") != len(outputs[name]) or not isinstance(data, bytes) or not 0 < len(data) <= 128 * 1024:
                raise ValueError("Invalid transport sequence")
            outputs[name].extend(data)
            if len(outputs[name]) > manifests[name]["size"]:
                raise ValueError("Oversized output")
        else:
            raise ValueError("Unknown output packet")
    if report is None or set(outputs) != {"native", "fluid"}:
        raise ValueError("Incomplete output")
    for name, data in outputs.items():
        if len(data) != manifests[name]["size"] or hashlib.sha256(data).hexdigest() != manifests[name]["sha256"]:
            raise ValueError("Output checksum mismatch")
    return report, manifests, {name: bytes(data) for name, data in outputs.items()}


def verify_media(outputs, report, directory):
    for name, data in outputs.items():
        path = Path(directory) / f"{name}.mp4"
        path.write_bytes(data)
        media = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path)], timeout=60))
        video = [s for s in media["streams"] if s["codec_type"] == "video"]
        audio = [s for s in media["streams"] if s["codec_type"] == "audio"]
        fps, count = (16, 64) if name == "native" else (60, report["output_frames"])
        if len(media["streams"]) != 2 or len(video) != 1 or len(audio) != 1:
            raise ValueError("Expected one picture and one audio stream")
        v, a = video[0], audio[0]
        if (v["codec_name"], v["width"], v["height"], Fraction(v["avg_frame_rate"]), int(v["nb_read_frames"])) != ("h264", 704, 1280, fps, count):
            raise ValueError("Unexpected picture geometry or frame coverage")
        if a["codec_name"] != "aac" or a["channels"] != 1 or abs(float(a.get("start_time", 0))) > .001 or abs(float(a["duration"]) - report["input_audio_seconds"]) > .1:
            raise ValueError("Unexpected dialogue timing")
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True, timeout=60)
