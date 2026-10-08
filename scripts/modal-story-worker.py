"""Deployable Studio worker. No test characters, balances, credentials or local output paths.

Deploy preparation only: python -m modal deploy scripts/modal-story-worker.py
The Studio runner invokes deliver.spawn after database reservation and claim.
"""
import modal
from pathlib import Path
from story_video_image import image
from story_video_runtime import GPU_OPTIONS, CPU_OPTIONS

ROOT = Path(__file__).resolve().parent
app = modal.App("content-ai-story-video")


@app.function(image=image, **GPU_OPTIONS)
def animate(**request):
    from story_video_engine import generate_speech
    if request.get("frames_count") != 64:
        raise ValueError("Unsupported deployed duration")
    yield from generate_speech(**request)


cpu_image = modal.Image.debian_slim(python_version="3.11").apt_install("ffmpeg").uv_pip_install("Pillow==11.3.0")
for name in ("story_video_contract.py", "story_video_engine.py", "story_video_image.py", "story_video_weights.py", "story_video_transport.py", "story_video_runtime.py", "story_video_relay.py"):
    cpu_image = cpu_image.add_local_file(ROOT / name, f"/root/{name}", copy=True)


@app.function(image=cpu_image, **CPU_OPTIONS)
def deliver(bundle):
    from story_video_relay import relay
    return relay(bundle, modal.current_function_call_id(), animate.remote_gen)
