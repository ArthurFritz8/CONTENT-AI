"""One bounded image-to-video experiment from the approved fruit concept.

python scripts/modal-wan-probe.py --run
No episodes, publishing, paid inference endpoints, or persistent volumes.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import time

import modal

ROOT = Path(__file__).resolve().parents[1]
MODEL = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
REVISION = "b8fff7315c768468a5333511427288870b2e9635"
INPUT_SHA = "498303a7c798119cf1763c84c656c9044ac8bb2fd97c242e5b49afccbde02ef6"
WIDTH, HEIGHT, FRAMES, FPS, STEPS, SEED = 704, 1248, 49, 24, 30, 42
PROMPT = (
    "Cinematic stylized realistic 3D animation. The exact two adult anthropomorphic fruit characters "
    "in the reference image remain in the same Brazilian street at golden hour. The apple woman "
    "with wavy chestnut hair and the cream floral dress raises one eyebrow and gently moves her open "
    "palm toward the orange man, asking him a question with a skeptical expression. The orange man "
    "with short dark hair, small moustache, linen shirt and blue jeans blinks and makes a small nervous "
    "head tilt, still keeping the biscuit behind his back. Subtle natural breathing and fabric motion. "
    "Stable locked camera, consistent faces, bodies, clothing, lighting and background. "
    "A restrained believable acting moment, expressive eyes, small coordinated gestures."
)
NEGATIVE = (
    "low quality, blurry, washed out, oversaturated, deformed face, changing identity, changing clothing, "
    "extra fingers, extra arms, fused hands, warped bodies, face morphing, melting, floating feet, "
    "rubber movement, fast motion, camera movement, camera cut, text, subtitles, watermark, flicker"
)


def download_model():
    from huggingface_hub import snapshot_download
    snapshot_download(
        MODEL, revision=REVISION, local_dir="/opt/wan-model", max_workers=4,
        allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt"],
    )


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .uv_pip_install(
        "torch==2.8.0", "diffusers==0.36.0", "transformers==4.57.1",
        "accelerate==1.11.0", "huggingface_hub==0.36.0", "sentencepiece==0.2.1",
        "ftfy==6.3.1", "imageio-ffmpeg==0.6.0", "Pillow==11.3.0", "numpy==2.2.6",
    )
    .run_function(download_model, timeout=900, cpu=2, memory=16384)
    .env({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"})
)
app = modal.App("content-ai-humanized-motion-probe")
logger = logging.getLogger("humanized-motion-probe")


def encode_video(frames, video: Path, width: int, height: int, fps: int):
    """Encode PIL frames using the system FFmpeg, without optional export backends."""
    import subprocess
    if not frames or any(getattr(frame, "size", None) != (width, height) for frame in frames):
        raise RuntimeError("Expected PIL frames with the requested video dimensions")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
        "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video),
    ], input=b"".join(frame.convert("RGB").tobytes() for frame in frames),
        check=True, capture_output=True, timeout=60)


@app.function(
    image=image, gpu="L40S", cpu=(4, 4), memory=(24576, 24576),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=900, startup_timeout=120, single_use_containers=True,
    restrict_modal_access=True, block_network=True, is_generator=True,
)
def animate(png: bytes):
    import subprocess
    import tempfile
    import torch
    from PIL import Image, ImageOps
    from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

    if len(png) > 12 * 1024 * 1024 or hashlib.sha256(png).hexdigest() != INPUT_SHA:
        raise ValueError("Only the approved reference is allowed in this experiment")
    started = time.perf_counter()
    source = ImageOps.fit(Image.open(io.BytesIO(png)).convert("RGB"), (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
    with tempfile.TemporaryDirectory() as preflight:
        encode_video([source], Path(preflight) / "encode-check.mp4", WIDTH, HEIGHT, FPS)
    torch.set_num_threads(4)
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA device")
    logger.warning("Loading pinned Wan model; GPU=%s", torch.cuda.get_device_name())
    vae = AutoencoderKLWan.from_pretrained("/opt/wan-model", subfolder="vae", torch_dtype=torch.float32, local_files_only=True)
    pipe = WanImageToVideoPipeline.from_pretrained(
        "/opt/wan-model", vae=vae, torch_dtype=torch.bfloat16,
        image_encoder=None, image_processor=None, local_files_only=True,
    )
    pipe.to("cuda")
    pipe.vae.enable_tiling()
    loaded_seconds = time.perf_counter() - started
    logger.warning("Model ready; starting %d frames, %d denoising steps", FRAMES, STEPS)

    def progress(pipeline, step, timestep, callback_kwargs):
        logger.warning("Denoising step %d/%d", step + 1, STEPS)
        return callback_kwargs

    frames = pipe(
        image=source, prompt=PROMPT, negative_prompt=NEGATIVE,
        height=HEIGHT, width=WIDTH, num_frames=FRAMES,
        num_inference_steps=STEPS, guidance_scale=5.0,
        output_type="pil",
        generator=torch.Generator(device="cuda").manual_seed(SEED),
        callback_on_step_end=progress,
    ).frames[0]
    inference_seconds = time.perf_counter() - started - loaded_seconds
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp)
        video = directory / "malu-laranjito-motion-v1.mp4"
        # Use the FFmpeg already in the image: Diffusers' optional exporter falls
        # back to OpenCV when imageio itself is absent, even with imageio-ffmpeg.
        if len(frames) != FRAMES:
            raise RuntimeError("Unexpected generated frame count")
        encode_video(frames, video, WIDTH, HEIGHT, FPS)
        metadata = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video),
        ], timeout=15))
        stream = next(s for s in metadata["streams"] if s["codec_type"] == "video")
        if (stream["width"], stream["height"], int(stream["nb_frames"])) != (WIDTH, HEIGHT, FRAMES):
            raise RuntimeError("Unexpected output dimensions or frame count")
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"], check=True, timeout=30, capture_output=True)
        report = {
            "model": MODEL, "revision": REVISION, "model_license": "Apache-2.0",
            "reference_sha256": INPUT_SHA, "width": WIDTH, "height": HEIGHT,
            "frames": FRAMES, "fps": FPS, "steps": STEPS, "seed": SEED,
            "gpu": torch.cuda.get_device_name(),
            "peak_cuda_allocated_gib": torch.cuda.max_memory_allocated() / 1024**3,
            "load_seconds": loaded_seconds, "inference_seconds": inference_seconds,
            "worker_seconds": time.perf_counter() - started,
            "duration_seconds": float(metadata["format"]["duration"]),
            "decode_verified": True, "audio": False, "lip_sync_validated": False,
            "production_enabled": False, "published": False, "database_writes": False,
            "prompt": PROMPT, "negative_prompt": NEGATIVE,
            "invoice_cost": "Not queried; provider usage/spend limits remain in place",
        }
        yield {"kind": "report", "report": report}
        data = video.read_bytes()
        yield {"kind": "manifest", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for offset in range(0, len(data), 128 * 1024):
            yield {"kind": "chunk", "offset": offset, "data": data[offset:offset + 128 * 1024]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    if not parser.parse_args().run:
        parser.error("--run is required after verifying Modal limits and available credits")
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key] = value.strip().strip("\"'")
    png = (ROOT / "output/humanized-fruit-concept/malu-laranjito-concept-v1.png").read_bytes()
    if hashlib.sha256(png).hexdigest() != INPUT_SHA:
        raise ValueError("Reference fingerprint does not match approval")
    output = ROOT / "output/humanized-motion-probe"
    output.mkdir(parents=True, exist_ok=True)
    report, manifest, result = None, None, bytearray()
    app_id = None
    started = time.perf_counter()
    try:
        with modal.enable_output(), app.run():
            app_id = app.app_id
            for item in animate.remote_gen(png):
                if item["kind"] == "report":
                    report = item["report"]
                elif item["kind"] == "manifest":
                    if manifest is not None or not 0 < item["size"] <= 20 * 1024 * 1024:
                        raise RuntimeError("Invalid output manifest")
                    manifest = item
                elif item["kind"] == "chunk":
                    if manifest is None or item["offset"] != len(result):
                        raise RuntimeError("Invalid chunk sequence")
                    result.extend(item["data"])
                    if len(result) > manifest["size"]:
                        raise RuntimeError("Oversized result")
                else:
                    raise RuntimeError("Unexpected response")
        if not report or not manifest or len(result) != manifest["size"] or hashlib.sha256(result).hexdigest() != manifest["sha256"]:
            raise RuntimeError("Incomplete output")
        report.update({"modal_app_id": app_id, "client_seconds": time.perf_counter() - started, "video_sha256": manifest["sha256"]})
        (output / "malu-laranjito-motion-v1.mp4").write_bytes(result)
        (output / "qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if (output / "failure.json").exists():
            (output / "failure.json").replace(output / "previous-failure.json")
        logger.info("Received complete motion test at %s", output)
    except Exception as exc:
        (output / "failure.json").write_text(json.dumps({"error_type": type(exc).__name__, "modal_app_id": app_id, "elapsed_seconds": time.perf_counter() - started}), encoding="utf-8")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
