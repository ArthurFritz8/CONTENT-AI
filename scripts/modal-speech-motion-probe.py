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
from story_motion_contract import FRAMES, NATIVE_FPS, OUTPUT_FPS, REFERENCE_SHA, validate_inputs, interpolation_schedule

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/audio-driven-motion-probe"
MODEL = "Wan-AI/Wan2.2-S2V-14B"
MODEL_REVISION = "dab4e9c55bbe4c8c4d03db1c2c98c7f0ac9c454b"
WAN_COMMIT = "1ea34ff48f87168174e12956e200b1d908b1c5ff"
RIFE_COMMIT = "bbfd2ea90910789a860ea3e2b32a240cd577b75e"
RIFE_REVISION = "01fdc7e97404120c243c3ea7b427046e5dc7643e"
RIFE_SHA = "1fa9b9cda3d9b8c3e301359e2595960902f97bf926c08598b0e9957a3f3f760e"
FLASH_WHEEL = (
    "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/"
    "flash_attn-2.8.3%2Bcu12torch2.8cxx11abiTRUE-cp311-cp311-linux_x86_64.whl"
    "#sha256=3d41b2fc55753faa7f45d6568ea73a96b96afb48b82994ab9b49bcbcb6c87588"
)
STEPS, SEED, MAX_AREA = 40, 2007, 720 * 1280
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
NEGATIVE = (
    "changing face, changing identity, distorted lips, extra teeth, missing mouth, permanently open "
    "mouth, motionless, blinking flicker, changing clothing, deformed hands, extra fingers, fast "
    "shaking, face morphing, plastic skin, low detail, watermark, text, subtitles, camera cuts"
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


def build_models():
    """CPU build only; pinned public weights and an explicit archive whitelist."""
    import zipfile
    from unittest.mock import patch
    from huggingface_hub import snapshot_download, hf_hub_download
    sys.path[:0] = ["/opt/wan", "/opt/rife"]
    # Upstream evaluates the default GPU index at import (T5/CLIP/VAEs).
    # CPU import preflight does not instantiate these classes; runtime is unpatched.
    with patch("torch.cuda.current_device", return_value=0):
        from wan.speech2video import WanS2V
    assert WanS2V
    snapshot_download(MODEL, revision=MODEL_REVISION, local_dir="/opt/s2v-model", max_workers=4,
        allow_patterns=["*.json", "diffusion_pytorch*.safetensors", "models_t5_umt5-xxl-enc-bf16.pth",
            "Wan2.1_VAE.pth", "google/umt5-xxl/*", "wav2vec2-large-xlsr-53-english/*.json",
            "wav2vec2-large-xlsr-53-english/model.safetensors", "README.md", "LICENSE*"])
    archive = Path(hf_hub_download("hzwer/RIFE", "RIFEv4.26_0921.zip", revision=RIFE_REVISION))
    if hashlib.sha256(archive.read_bytes()).hexdigest() != RIFE_SHA:
        raise ValueError("RIFE author release fingerprint mismatch")
    destination = Path("/opt/rife/train_log")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for name in ("flownet.pkl", "IFNet_HDv3.py", "refine.py", "RIFE_HDv3.py"):
            (destination / name).write_bytes(package.read("RIFEv4.26_0921/" + name))
    # Imports are verified before allocating a GPU; no FlashAttention build is required.
    sys.path[:0] = ["/opt/wan", "/opt/rife"]
    from train_log.IFNet_HDv3 import IFNet
    assert WanS2V and IFNet
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=s=64x64",
        "-frames:v", "1", "-c:v", "libx264", "-f", "null", "-"], check=True, timeout=30)


def load_interpolator(device="cpu"):
    import torch
    sys.path.insert(0, "/opt/rife")
    from train_log.IFNet_HDv3 import IFNet
    net = IFNet().eval()
    state = torch.load("/opt/rife/train_log/flownet.pkl", map_location="cpu", weights_only=True)
    state = {key.removeprefix("module."): value for key, value in state.items()}
    # Author checkpoint includes two training-only heads, commented out in IFNet.
    # All active inference parameters must still match exactly (not blanket strict=False).
    state = {key: value for key, value in state.items() if not key.startswith(("teacher.", "caltime."))}
    net.load_state_dict(state, strict=True)
    return net.to(device)


def check_interpolator():
    load_interpolator()
    logger.info("RIFE active weights match author inference architecture")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0")
    .uv_pip_install("torch==2.8.0", "torchvision==0.23.0", "torchaudio==2.8.0",
        "numpy==1.26.4", "transformers==4.51.3", "diffusers==0.33.1", "tokenizers==0.21.4",
        "accelerate==1.11.0", "huggingface_hub==0.36.0", "decord==0.6.0", "librosa==0.11.0",
        "soundfile==0.13.1", "scipy==1.15.3", "opencv-python-headless==4.11.0.86",
        "einops==0.8.1", "easydict==1.13", "tqdm==4.67.1", "ftfy==6.3.1",
        "imageio==2.37.0", "imageio-ffmpeg==0.6.0", "safetensors==0.5.3",
        "Pillow==11.3.0", "sentencepiece==0.2.1", "protobuf==5.29.5", "peft==0.15.2")
    .run_commands(
        "git clone https://github.com/Wan-Video/Wan2.2.git /opt/wan && git -C /opt/wan checkout " + WAN_COMMIT,
        "git clone https://github.com/hzwer/Practical-RIFE.git /opt/rife && git -C /opt/rife checkout " + RIFE_COMMIT)
    .add_local_file(ROOT / "scripts/story_motion_contract.py", "/root/story_motion_contract.py", copy=True)
    .run_function(build_models, timeout=1800, cpu=4, memory=16384)
    # S2V cross-attention calls flash_attention directly, unlike TI2V's SDPA fallback.
    .uv_pip_install(FLASH_WHEEL)
    .run_commands("python -c 'import torch, flash_attn; assert torch._C._GLIBCXX_USE_CXX11_ABI; print(flash_attn.__version__)'")
    .run_function(check_interpolator, timeout=60, cpu=2, memory=2048)
    .env({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false",
        "PYTHONPATH": "/opt/wan:/opt/rife:/opt/experiment"})
)
app = modal.App("content-ai-audio-driven-motion-probe")


def encode(frames, destination: Path, width: int, height: int, fps: int):
    """Stream pixels to FFmpeg without retaining another full uncompressed video."""
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0", "-an", "-c:v", "libx264",
        "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for frame in frames:
            if frame.shape != (height, width, 3):
                raise ValueError("Unexpected frame dimensions")
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        error = process.stderr.read()
        if process.wait(timeout=120) != 0:
            raise RuntimeError(error.decode("utf-8", errors="replace")[-2000:])
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stderr.close()


@app.function(image=image, gpu="H100", cpu=(4, 4), memory=(65536, 65536),
    max_containers=1, min_containers=0, buffer_containers=0, scaledown_window=2,
    timeout=2100, startup_timeout=180, restrict_modal_access=True, block_network=True,
    is_generator=True)
def speak(png: bytes, wav: bytes, audio_sha: str, *, frames_count=FRAMES,
          reference_sha=REFERENCE_SHA, prompt=PROMPT, seed=SEED):
    import tempfile
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image, ImageOps
    from wan.speech2video import WanS2V
    from wan.configs.wan_s2v_14B import s2v_14B
    import io
    seconds = validate_inputs(png, wav, audio_sha, frames=frames_count, reference_sha=reference_sha)
    if not isinstance(prompt, str) or not 100 <= len(prompt) <= 2000 or not isinstance(seed, int) or not 0 <= seed <= 10000:
        raise ValueError("Invalid bounded acting direction")
    start = time.perf_counter()
    yield {"kind": "progress", "stage": "loading-audio-driven-model"}
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        reference = directory / "reference.png"
        ImageOps.fit(Image.open(io.BytesIO(png)).convert("RGB"), (704, 1248)).save(reference)
        voice = directory / "voice.wav"
        voice.write_bytes(wav)
        pipeline = WanS2V(config=s2v_14B, checkpoint_dir="/opt/s2v-model", device_id=0,
            t5_cpu=True, init_on_cpu=True, convert_model_dtype=True)
        yield {"kind": "progress", "stage": "audio-conditioned-generation", "steps": STEPS}
        tensor = pipeline.generate(input_prompt=prompt, ref_image_path=str(reference), audio_path=str(voice),
            enable_tts=False, tts_prompt_audio=None, tts_prompt_text=None, tts_text=None,
            num_repeat=1, pose_video=None, max_area=MAX_AREA, infer_frames=frames_count, shift=3.0,
            sample_solver="unipc", sampling_steps=STEPS, guide_scale=4.5, n_prompt=NEGATIVE,
            seed=seed, offload_model=True, init_first_frame=True)
        frames = (tensor.clamp(-1, 1).permute(1, 2, 3, 0).float().add(1).mul(127.5).round().byte().numpy())
        del pipeline, tensor
        gc.collect()
        torch.cuda.empty_cache()
        if len(frames) != frames_count:
            raise ValueError("Unexpected S2V frame count; refuse ambiguous timing")
        height, width = frames.shape[1:3]
        encode(frames, directory / "native-silent.mp4", width, height, NATIVE_FPS)
        yield {"kind": "progress", "stage": "neural-frame-interpolation", "native_frames": len(frames)}
        net = load_interpolator("cuda")
        pad_w, pad_h = (-width) % 64, (-height) % 64
        interpolated_count = 0
        inferred_count = 0
        def smooth_frames():
            nonlocal interpolated_count, inferred_count
            pair = None
            inputs = None
            with torch.inference_mode():
                for left, right, alpha in interpolation_schedule(len(frames), NATIVE_FPS, OUTPUT_FPS):
                    interpolated_count += 1
                    if alpha == 0:
                        yield frames[left]
                        continue
                    if pair != (left, right):
                        inputs = torch.from_numpy(np.stack((frames[left], frames[right]))).permute(0, 3, 1, 2).cuda().float() / 255
                        inputs = F.pad(inputs, (0, pad_w, 0, pad_h))
                        pair = (left, right)
                    merged = net(torch.cat((inputs[0:1], inputs[1:2]), 1), alpha, [16, 8, 4, 2, 1])[2][-1]
                    inferred_count += 1
                    yield (merged[0, :, :height, :width].clamp(0, 1).permute(1, 2, 0) * 255).round().byte().cpu().numpy()
        encode(smooth_frames(), directory / "fluid-silent.mp4", width, height, OUTPUT_FPS)
        for name in ("native", "fluid"):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(directory / f"{name}-silent.mp4"),
                "-i", str(voice), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
                "-b:a", "96k", "-movflags", "+faststart", str(directory / f"{name}.mp4")], check=True, timeout=60)
        report = {"audio_conditioned": True, "lip_sync_validated": False, "human_review_required": True,
            "input_audio_sha256": audio_sha, "input_audio_seconds": seconds, "audio_offset_seconds": 0,
            "init_first_frame": True, "native_fps": NATIVE_FPS, "native_frames": len(frames),
            "output_fps": OUTPUT_FPS, "output_frames": interpolated_count, "neural_intermediate_frames": inferred_count,
            "width": width, "height": height, "steps": STEPS, "seed": seed, "acting_prompt": prompt,
            "model": MODEL, "model_revision": MODEL_REVISION, "wan_commit": WAN_COMMIT,
            "rife_revision": RIFE_REVISION, "rife_weights_sha256": RIFE_SHA,
            "reference_sha256": hashlib.sha256(png).hexdigest(), "worker_seconds": time.perf_counter() - start,
            "no_loop_no_speed_change": True, "license": {"wan": "Apache-2.0", "rife": "MIT"}}
        yield {"kind": "report", "report": report}
        for name in ("native", "fluid"):
            data = (directory / f"{name}.mp4").read_bytes()
            yield {"kind": "manifest", "name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for offset in range(0, len(data), 128 * 1024):
                yield {"kind": "chunk", "name": name, "offset": offset, "data": data[offset:offset + 128 * 1024]}


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


def prepare_expressive():
    """Controlled acting comparison: same approved image, PCM, seed and model."""
    baseline = ROOT / "output/audio-driven-motion-probe"
    data = json.loads((baseline / "input.json").read_text(encoding="utf-8"))
    approved = json.loads((baseline / "qa.json").read_text(encoding="utf-8"))
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
    data.update(prompt=EXPRESSIVE_PROMPT, negative_prompt=NEGATIVE,
        baseline_sha256=approved["outputs"]["fluid"]["sha256"],
        experiment="acting-only-v1", seed=SEED, native_fps=NATIVE_FPS, output_fps=OUTPUT_FPS,
        max_new_gpu_calls=1, worker_timeout_seconds=2100,
        worker_timeout_upper_estimate_usd=2100 * (.001097 + 4 * .0000131 + 64 * .00000222),
        budget_scope="worker only; excludes build/startup/idle; not invoice or remaining balance",
        pose_conditioned=False, production_enabled=False, published=False)
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


def run(build_only=False, expressive=False):
    png = (ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes()
    wav = (OUT / "voice.wav").read_bytes()
    inputs = json.loads((OUT / "input.json").read_text(encoding="utf-8"))
    expected = inputs["audio_sha256"]
    prompt = EXPRESSIVE_PROMPT if expressive else PROMPT
    if inputs["prompt"] != prompt or inputs["negative_prompt"] != NEGATIVE or inputs.get("seed", SEED) != SEED:
        raise ValueError("Experiment direction differs from the reviewed manifest")
    validate_inputs(png, wav, expected)  # Reject before creating cloud app.
    if (OUT / "qa.json").exists():
        raise ValueError("Completed test exists; do not spend credits regenerating silently")
    lock = OUT / "generation.lock.json"
    if (OUT / "failure.json").exists() or lock.exists():
        raise ValueError("Inspect previous failure/reservation; never retry automatically")
    for line in (ROOT / ".env.cloud").read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {"MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"}:
            os.environ[key] = value.strip().strip("\"'")
    results, manifests, report = {}, {}, None
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
            for item in speak.remote_gen(png, wav, expected, prompt=prompt):
                if item["kind"] == "progress":
                    logger.info("Stage: %s", item["stage"])
                elif item["kind"] == "report":
                    report = item["report"]
                elif item["kind"] == "manifest":
                    name = item["name"]
                    if name not in {"native", "fluid"} or name in manifests or not 0 < item["size"] <= 30 * 1024 * 1024:
                        raise ValueError("Invalid output manifest")
                    manifests[name], results[name] = item, bytearray()
                elif item["kind"] == "chunk":
                    name = item["name"]
                    if name not in manifests or item["offset"] != len(results[name]) or len(item["data"]) > 128 * 1024:
                        raise ValueError("Invalid transport sequence")
                    results[name].extend(item["data"])
                    if len(results[name]) > manifests[name]["size"]:
                        raise ValueError("Oversized output")
                else:
                    raise ValueError("Unknown worker response")
        if report is None or set(results) != {"native", "fluid"}:
            raise ValueError("Incomplete test")
        for name, data in results.items():
            if len(data) != manifests[name]["size"] or hashlib.sha256(data).hexdigest() != manifests[name]["sha256"]:
                raise ValueError("Output checksum mismatch")
            temporary = OUT / f"{name}.tmp.mp4"
            temporary.write_bytes(data)
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(temporary), "-f", "null", "-"], check=True, timeout=60)
            temporary.replace(OUT / f"malu-{name}.mp4")
        report.update({"modal_app_id": app_id, "client_seconds": time.perf_counter() - started, "outputs": manifests})
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
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--run", action="store_true")
    action.add_argument("--build-only", action="store_true")
    parser.add_argument("--expressive", action="store_true", help="Isolated acting comparison, preserves approved baseline")
    arguments = parser.parse_args()
    if arguments.expressive:
        OUT = ROOT / "output/expressive-speech-motion-probe"
    if arguments.prepare:
        prepare_expressive() if arguments.expressive else prepare()
    else:
        run(build_only=arguments.build_only, expressive=arguments.expressive)
