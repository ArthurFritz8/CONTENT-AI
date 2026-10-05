"""Bounded, opt-in cloud experiment; never creates episodes or publishes.

Run: python scripts/modal-render-probe.py --run
Credentials are loaded only from the git-ignored .env.cloud, never uploaded.
Requires the own-art Blender sample in output/animation-3d.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
from pathlib import Path
import time

import modal

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "modal-render-probe"
WIDTH, HEIGHT, FPS, CLIP_FRAMES = 540, 960, 24, 24
TIMEOUT_SECONDS = 180

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("xorg", "libxkbcommon0", "ffmpeg")
    .uv_pip_install("bpy==4.5.14")
)
app = modal.App("content-ai-blender-probe")
logger = logging.getLogger("modal-render-probe")


@app.function(
    image=image, gpu=["L4", "A10"], cpu=(2, 2), memory=(4096, 4096),
    max_containers=1, min_containers=0, buffer_containers=0,
    scaledown_window=2, timeout=TIMEOUT_SECONDS, startup_timeout=90,
    single_use_containers=True,
    block_network=True, restrict_modal_access=True, is_generator=True,
)
def render_sample(blend_bytes: bytes, audio_bytes: bytes):
    import bpy
    import subprocess
    import tempfile

    if not 0 < len(blend_bytes) <= 25 * 1024 * 1024:
        raise ValueError("Blend sample exceeds the experiment limit")
    if not 0 < len(audio_bytes) <= 2 * 1024 * 1024:
        raise ValueError("Audio sample exceeds the experiment limit")
    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        blend_path = root / "sample.blend"
        blend_path.write_bytes(blend_bytes)
        # Never execute embedded Blender Python or follow external asset paths.
        bpy.ops.wm.open_mainfile(filepath=str(blend_path), use_scripts=False)
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "GPU"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "CUDA"
        prefs.refresh_devices()
        devices = []
        for device in prefs.devices:
            device.use = device.type == "CUDA"
            if device.use:
                devices.append(device.name)
        if not devices:
            raise RuntimeError("No CUDA GPU: refusing silent CPU fallback")
        scene.render.resolution_x = WIDTH
        scene.render.resolution_y = HEIGHT
        scene.render.resolution_percentage = 100
        scene.render.threads_mode = "FIXED"
        scene.render.threads = 2
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.use_compositing = False
        scene.render.use_sequencer = False
        timings = []
        previews = {}
        for frame in list(range(1, CLIP_FRAMES + 1)) + [170, 330, 420]:
            scene.frame_set(frame)
            path = root / f"frame-{frame:04d}.png"
            scene.render.filepath = str(path)
            frame_started = time.perf_counter()
            bpy.ops.render.render(write_still=True)
            timings.append({"frame": frame, "seconds": round(time.perf_counter() - frame_started, 3)})
            if frame in [1, 170, 330, 420]:
                previews[str(frame)] = path.read_bytes()
        (root / "audio.wav").write_bytes(audio_bytes)
        video = root / "cloud-sample.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-framerate", str(FPS),
            "-start_number", "1", "-i", str(root / "frame-%04d.png"),
            "-i", str(root / "audio.wav"), "-frames:v", str(CLIP_FRAMES),
            "-t", str(CLIP_FRAMES / FPS), "-c:v", "libx264", "-crf", "20",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-af", "afade=t=out:st=0.85:d=0.15", "-movflags", "+faststart", str(video),
        ], check=True, timeout=20, capture_output=True)
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_streams", "-show_format",
            "-of", "json", str(video),
        ], check=True, timeout=10, capture_output=True, text=True)
        subprocess.run([
            "ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-",
        ], check=True, timeout=10, capture_output=True)
        metadata = json.loads(probe.stdout)
        video_stream = next(s for s in metadata["streams"] if s["codec_type"] == "video")
        audio_stream = next(s for s in metadata["streams"] if s["codec_type"] == "audio")
        if (video_stream["width"], video_stream["height"]) != (WIDTH, HEIGHT):
            raise RuntimeError("Unexpected video resolution")
        if int(video_stream["nb_frames"]) != CLIP_FRAMES:
            raise RuntimeError("Incomplete rendered clip")
        if abs(float(metadata["format"]["duration"]) - CLIP_FRAMES / FPS) > 0.1:
            raise RuntimeError("Unexpected clip duration")
        if video_stream["codec_name"] != "h264" or audio_stream["codec_name"] != "aac":
            raise RuntimeError("Unexpected codecs")
        yield {
            "kind": "report", "report": {
                "prototype": True, "production_enabled": False,
                "published": False, "database_writes": False,
                "blender": bpy.app.version_string, "engine": "Cycles / CUDA",
                "gpu_devices": devices, "samples": 16,
                "width": WIDTH, "height": HEIGHT, "fps": FPS,
                "clip_frames": CLIP_FRAMES, "still_frames": 3,
                "duration_seconds": float(metadata["format"]["duration"]),
                "worker_seconds": round(time.perf_counter() - started, 3),
                "frame_timings": timings, "decode_verified": True,
                "video_codec": "h264", "audio_codec": "aac",
                "license": "own", "source": "system",
                "visual_limit": "Existing geometric characters; not the humanized art target",
                "production_qa": "Not evaluated: short experiment, not a 60s episode",
                "persistent_volumes": False, "retries": 0,
            },
        }
        # Restricted workers cannot call BlobCreate for a large combined return.
        # Each streamed payload stays small enough for inline transport.
        artifacts = {"cloud-sample.mp4": video.read_bytes()}
        artifacts.update({f"preview-{frame}.png": png for frame, png in previews.items()})
        for name, data in artifacts.items():
            yield {"kind": "manifest", "name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for offset in range(0, len(data), 128 * 1024):
                yield {"kind": "chunk", "name": name, "offset": offset, "data": data[offset:offset + 128 * 1024]}


def load_credentials() -> None:
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key.strip()] = value.strip().strip("\"'")
    if not all(os.environ.get(key) for key in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET")):
        raise RuntimeError("Missing Modal credentials in .env.cloud")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Execute one bounded GPU experiment")
    args = parser.parse_args()
    if not args.run:
        parser.error("Use --run after verifying workspace usage/spend limits")
    load_credentials()
    blend_bytes = (ROOT / "output/animation-3d/novela-frutas-3d.blend").read_bytes()
    audio_bytes = (ROOT / "output/animation-3d/mix.wav").read_bytes()
    if len(blend_bytes) > 25 * 1024 * 1024 or len(audio_bytes) > 2 * 1024 * 1024:
        raise ValueError("Local sample exceeds the experiment payload limits")
    started = time.perf_counter()
    artifacts = {}
    manifests = {}
    report = None
    expected = {"cloud-sample.mp4", "preview-1.png", "preview-170.png", "preview-330.png", "preview-420.png"}
    with modal.enable_output(), app.run():
        for item in render_sample.remote_gen(blend_bytes, audio_bytes):
            if item["kind"] == "report":
                if report is not None:
                    raise RuntimeError("Duplicate report")
                report = item["report"]
                continue
            name = item["name"]
            if name not in expected:
                raise RuntimeError("Unexpected artifact name")
            if item["kind"] == "manifest":
                if name in manifests or not 0 < item["bytes"] <= 10 * 1024 * 1024:
                    raise RuntimeError("Invalid artifact manifest")
                manifests[name] = item
                artifacts[name] = bytearray()
            elif item["kind"] == "chunk":
                if name not in manifests or item["offset"] != len(artifacts[name]):
                    raise RuntimeError("Missing, duplicate, or reordered chunk")
                artifacts[name].extend(item["data"])
                if len(artifacts[name]) > manifests[name]["bytes"]:
                    raise RuntimeError("Oversized artifact")
            else:
                raise RuntimeError("Unexpected response kind")
        app_id = app.app_id
    if report is None or set(artifacts) != expected:
        raise RuntimeError("Incomplete cloud result")
    for name, data in artifacts.items():
        if len(data) != manifests[name]["bytes"] or hashlib.sha256(data).hexdigest() != manifests[name]["sha256"]:
            raise RuntimeError("Incomplete or corrupted artifact")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        (OUTPUT / name).write_bytes(data)
    report.update({
        "modal_app_id": app_id,
        "client_elapsed_seconds_including_build_upload_startup": round(time.perf_counter() - started, 3),
        "input_blend_sha256": hashlib.sha256(blend_bytes).hexdigest(),
        "video_bytes": len(artifacts["cloud-sample.mp4"]),
        "artifact_transport": "128 KiB inline chunks; manifests and SHA-256 verified",
        "invoice_cost": "Not available from this experiment; check Modal billing",
        "approved_account_limits": {"usage_usd": 30, "spend_usd": 0, "evidence": "operator dashboard screenshot"},
    })
    (OUTPUT / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Cloud sample passed technical checks: %s", OUTPUT)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
