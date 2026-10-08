"""Pinned Wan S2V + RIFE engine shared by auditions and the Studio worker.
No Modal deployment, credentials or artistic test fixtures live in this module.
"""
from __future__ import annotations
import gc
import hashlib
from pathlib import Path
import subprocess
import time
from story_video_contract import FRAMES, NATIVE_FPS, OUTPUT_FPS, validate_request, interpolation_schedule
from story_video_weights import MODEL, MODEL_REVISION, WAN_COMMIT, RIFE_REVISION, RIFE_SHA, load_interpolator

STEPS, SEED, MAX_AREA = 40, 2007, 720 * 1280
GENERATION_SETTINGS = {"num_repeat": 1, "max_area": MAX_AREA, "shift": 3.0,
    "sample_solver": "unipc", "sampling_steps": STEPS, "guide_scale": 4.5,
    "offload_model": True, "init_first_frame": True}
NEGATIVE = (
    "changing face, changing identity, distorted lips, extra teeth, missing mouth, permanently open "
    "mouth, motionless, blinking flicker, changing clothing, deformed hands, extra fingers, fast "
    "shaking, face morphing, plastic skin, low detail, watermark, text, subtitles, camera cuts"
)


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


class ModelSession:
    """Retain weights inside at most two bounded takes, never a warm service."""
    def __init__(self):
        self.pipeline = None
        self.uses = 0
        self.closed = False

    def acquire(self, factory):
        if self.closed or self.uses >= 2:
            raise ValueError("Model session exhausted or closed")
        reused = self.pipeline is not None
        self.uses += 1
        try:
            if not reused:
                self.pipeline = factory()
        except BaseException:
            self.close()  # no hidden reload/retry after failed construction
            raise
        return self.pipeline, reused

    def close(self):
        self.pipeline = None
        self.closed = True


def generate_speech(png: bytes, wav: bytes, audio_sha: str, *, frames_count=FRAMES,
                    reference_sha, prompt, seed, pose=None, pose_sha=None,
                    model_session=None):
    entry_start = time.perf_counter()
    seconds = validate_request(png, wav, audio_sha, frames_count=frames_count,
        reference_sha=reference_sha, prompt=prompt, seed=seed, pose=pose, pose_sha=pose_sha)
    validated = time.perf_counter()
    import tempfile
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image, ImageOps
    from wan.speech2video import WanS2V
    from wan.configs.wan_s2v_14B import s2v_14B
    import io
    imported = time.perf_counter()
    start = time.perf_counter()
    stage_seconds = {"imports": imported-validated, "input_validation": validated-entry_start}
    yield {"kind": "progress", "stage": "loading-audio-driven-model"}
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        reference = directory / "reference.png"
        ImageOps.fit(Image.open(io.BytesIO(png)).convert("RGB"), (704, 1248)).save(reference)
        voice = directory / "voice.wav"
        voice.write_bytes(wav)
        pose_path = directory / "pose.mp4" if pose is not None else None
        if pose_path is not None:
            pose_path.write_bytes(pose)
        load_start = time.perf_counter()
        stage_seconds["input_preparation"] = load_start-start
        def load_pipeline():
            return WanS2V(config=s2v_14B, checkpoint_dir="/opt/s2v-model", device_id=0,
                t5_cpu=True, init_on_cpu=True, convert_model_dtype=True)
        pipeline, reused = model_session.acquire(load_pipeline) if model_session else (load_pipeline(), False)
        generation_start = time.perf_counter()
        stage_seconds["model_loading"] = generation_start-load_start
        torch.cuda.reset_peak_memory_stats()
        yield {"kind": "progress", "stage": "audio-conditioned-generation", "steps": STEPS}
        tensor = pipeline.generate(input_prompt=prompt, ref_image_path=str(reference), audio_path=str(voice),
            enable_tts=False, tts_prompt_audio=None, tts_prompt_text=None, tts_text=None,
            pose_video=str(pose_path) if pose_path else None, infer_frames=frames_count, n_prompt=NEGATIVE,
            seed=seed, **GENERATION_SETTINGS)
        frames = (tensor.clamp(-1, 1).permute(1, 2, 3, 0).float().add(1).mul(127.5).round().byte().numpy())
        raw_hash = hashlib.sha256()
        for frame in frames:
            raw_hash.update(frame.tobytes())
        raw_native_sha = raw_hash.hexdigest()
        peak_gpu_bytes = torch.cuda.max_memory_allocated()
        generated = time.perf_counter()
        stage_seconds["generation_and_frame_transfer"] = generated-generation_start
        del pipeline, tensor
        gc.collect()
        torch.cuda.empty_cache()
        if len(frames) != frames_count:
            raise ValueError("Unexpected S2V frame count; refuse ambiguous timing")
        height, width = frames.shape[1:3]
        encode(frames, directory / "native-silent.mp4", width, height, NATIVE_FPS)
        interpolation_start = time.perf_counter()
        stage_seconds["model_release_and_native_encode"] = interpolation_start-generated
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
        mux_start = time.perf_counter()
        stage_seconds["interpolator_loading_and_fluid_encode"] = mux_start-interpolation_start
        for name in ("native", "fluid"):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(directory / f"{name}-silent.mp4"),
                "-i", str(voice), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
                "-b:a", "96k", "-movflags", "+faststart", str(directory / f"{name}.mp4")], check=True, timeout=60)
        finished = time.perf_counter()
        stage_seconds["audio_mux"] = finished-mux_start
        report = {"audio_conditioned": True, "lip_sync_validated": False, "human_review_required": True,
            "pose_conditioned": pose is not None, "pose_sha256": pose_sha,
            "input_audio_sha256": audio_sha, "input_audio_seconds": seconds, "audio_offset_seconds": 0,
            "init_first_frame": True, "native_fps": NATIVE_FPS, "native_frames": len(frames),
            "output_fps": OUTPUT_FPS, "output_frames": interpolated_count, "neural_intermediate_frames": inferred_count,
            "width": width, "height": height, "steps": STEPS, "seed": seed, "acting_prompt": prompt,
            "model": MODEL, "model_revision": MODEL_REVISION, "wan_commit": WAN_COMMIT,
            "rife_revision": RIFE_REVISION, "rife_weights_sha256": RIFE_SHA,
            "model_reused": reused, "model_retained_for_batch": model_session is not None,
            "generation_settings": dict(GENERATION_SETTINGS), "negative_prompt": NEGATIVE,
            "raw_native_rgb_sha256": raw_native_sha, "generation_peak_gpu_allocated_bytes": peak_gpu_bytes,
            "gpu_name": torch.cuda.get_device_name(0),
            "reference_sha256": hashlib.sha256(png).hexdigest(), "worker_seconds": time.perf_counter() - start,
            "stage_seconds":stage_seconds,"worker_entry_seconds":finished-entry_start,
            "timing_scope":"worker_seconds excludes imports/validation for historic comparability; entry includes them; both exclude boot/image build/transport/idle",
            "no_loop_no_speed_change": True, "license": {"wan": "Apache-2.0", "rife": "MIT"}}
        yield {"kind": "report", "report": report}
        for name in ("native", "fluid"):
            data = (directory / f"{name}.mp4").read_bytes()
            yield {"kind": "manifest", "name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for offset in range(0, len(data), 128 * 1024):
                yield {"kind": "chunk", "name": name, "offset": offset, "data": data[offset:offset + 128 * 1024]}
