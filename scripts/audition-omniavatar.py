"""One isolated Malu/OmniAvatar audition. Never changes Studio or publishes."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import re
import shutil
import subprocess
import sys
import time
import wave

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output/free-video-jobs/omniavatar-malu-2026-10-08"
# Isolated research helper: install gradio_client==1.14.0 into this ignored path.
sys.path.insert(0, str(ROOT / "output/provider-research-deep-2026-10-08/gradio-client"))
import httpx
from gradio_client import Client, handle_file

SPACE = "alexnasa/OmniAvatar"
REVISION = "e6a7899449e8a16003b0b01046ea6d29dbbd00c5"
IMAGE = ROOT / "output/suitcase-story-preview/references/malu-entryway-v1.png"
AUDIO = ROOT / "output/suitcase-story-preview/02/voice.wav"
IMAGE_SHA = "d7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c"
AUDIO_SHA = "8dbf56e5e72b4ee9db8b1a823d7e81ada20f25e86b9f2d8adc18bf7ada91c632"
PROMPT = (
    "Cinematic lifelike 3D fruit-soap-opera close-up. The same apple-headed woman "
    "in the reference speaks Brazilian Portuguese in sync with the supplied voice. "
    "She looks skeptical, raises an eyebrow, turns her head slightly and makes one "
    "restrained shoulder gesture. Preserve the exact sharp expressive eyes, face, "
    "red apple skin texture, curly auburn hair, floral dress, warm apartment lighting "
    "and background. Stable anatomy, natural motion, no new characters, no text."
)


def read_json(path: Path, fallback=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def save_json(path: Path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)


def main():
    if sys.argv[1:] not in (["--preflight"], ["--run"]):
        raise RuntimeError("Use --preflight ou --run")
    run = sys.argv[1] == "--run"
    if run:
        raise SystemExit("OmniAvatar vetado: rosto e olhos borrados. Nova geracao bloqueada antes de qualquer chamada ao provedor.")
    OUT.mkdir(parents=True, exist_ok=True)
    lock_path = ROOT / "output/free-video-jobs/provider.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    try:
        state_path = OUT / "state.json"
        if run and read_json(state_path, {"status": "new"})["status"] != "new":
            raise RuntimeError("Já existe submissão ou estado incerto; não repetir")
        if sha256(IMAGE.read_bytes()).hexdigest() != IMAGE_SHA or sha256(AUDIO.read_bytes()).hexdigest() != AUDIO_SHA:
            raise RuntimeError("Fonte de imagem ou voz foi alterada")
        with wave.open(str(AUDIO), "rb") as wav:
            if (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) != (1, 16000, 2) or abs(wav.getnframes()/16000-3.25) > 0.02:
                raise RuntimeError("Formato ou duração da voz mudou")
        metadata = httpx.get(f"https://huggingface.co/api/spaces/{SPACE}", timeout=15).json()
        runtime = metadata.get("runtime") or {}
        if metadata.get("sha") != REVISION or runtime.get("stage") != "RUNNING" or (runtime.get("hardware") or {}).get("current") != "zero-a10g":
            raise RuntimeError("Revisão/hardware do Space mudou; revalidar antes de gerar")
        env = (ROOT / ".env.cloud").read_text(encoding="utf-8")
        token = next((line.split("=", 1)[1].strip().strip("\"'") for line in env.splitlines() if line.startswith("HF_TOKEN=")), None)
        if not token:
            raise RuntimeError("HF_TOKEN ausente")
        client = Client(SPACE, hf_token=token, verbose=False, analytics_enabled=False, download_files=str(OUT))
        args = (handle_file(str(IMAGE)), handle_file(str(AUDIO)), PROMPT, 4)
        estimate = client.predict(*args, api_name="/update_generate_button")
        label = estimate.get("value") if isinstance(estimate, dict) else str(estimate)
        match = re.search(r"Required:\s*~([0-9.]+)s", label)
        allocated = float(match.group(1)) if match else 0
        # Owner's 2026-10-08 screenshot shows 0.4/5 min used. xlarge costs 2x.
        remaining = 276
        reservation = allocated * 2
        preflight = {"space": SPACE, "revision": REVISION, "audio_seconds": 3.25,
                     "steps": 4, "gpu_seconds": allocated, "estimated_quota_seconds": reservation,
                     "observed_remaining_seconds": remaining, "snapshot": "operator screenshot: 0.4/5 min",
                     "quality_unverified": True, "production_enabled": False}
        save_json(OUT / "preflight.json", preflight)
        print(json.dumps({"preflight": preflight}, ensure_ascii=True), flush=True)
        if not 0 < allocated <= 120 or reservation + 30 > remaining:
            raise RuntimeError("Estimativa não cabe na cota observada com margem")
        if not run:
            return
        if datetime.now(timezone.utc).date().isoformat() != "2026-10-08":
            raise RuntimeError("Snapshot de cota expirou; não usar em outro dia")
        ledger_path = ROOT / "output/free-video-jobs/quota.json"
        ledger = read_json(ledger_path)
        if ledger != {"day": "2026-10-08", "attempts": 2, "cooldown_until": 0}:
            raise RuntimeError("Ledger local mudou; revalidar quota")
        save_json(ledger_path, {"day": "2026-10-08", "attempts": 3, "cooldown_until": 0})
        save_json(state_path, {"status": "submitting", "at": time.time(), "provider": SPACE})
        job = client.submit(*args, api_name="/infer_scene")
        deadline = time.monotonic() + 45
        while not job.done() and not job.communicator.event_id and time.monotonic() < deadline:
            time.sleep(0.1)
        event_id = job.communicator.event_id
        if event_id:
            save_json(state_path, {"status": "accepted", "event_id": event_id, "at": time.time(), "provider": SPACE})
            print(json.dumps({"status": "accepted", "event_id": event_id}), flush=True)
        # Once submitting, any exception is terminal/uncertain. Never submit again.
        result = job.result(timeout=900)
        video = result.get("video") if isinstance(result, dict) else result
        if isinstance(video, dict):
            video = video.get("path") or video.get("url")
        source = Path(str(video))
        if not source.is_file() or source.stat().st_size > 64 * 1024 * 1024:
            raise RuntimeError("Gradio não devolveu um MP4 local válido")
        clip = OUT / "clip.mp4"
        if source.resolve() != clip.resolve():
            shutil.copyfile(source, clip)
        raw = clip.read_bytes()
        if len(raw) < 12 or raw[4:8] != b"ftyp":
            raise RuntimeError("Saída não é MP4")
        media = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(clip)],
                                          capture_output=True, text=True, check=True, timeout=30).stdout)
        subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(clip), "-f", "null", "-"],
                       capture_output=True, check=True, timeout=60)
        stream = next(x for x in media["streams"] if x["codec_type"] == "video")
        qa = {"sha256": sha256(raw).hexdigest(), "width": stream["width"], "height": stream["height"],
              "fps": stream["avg_frame_rate"], "duration": float(media["format"]["duration"]),
              "has_audio": any(x["codec_type"] == "audio" for x in media["streams"]),
              "decode_verified": True, "visual_approval": False, "production_enabled": False}
        save_json(OUT / "qa.json", qa)
        save_json(state_path, {"status": "ready", "event_id": event_id, "sha256": qa["sha256"]})
        print(json.dumps({"status": "ready", "path": str(clip), "qa": qa}), flush=True)
    finally:
        lock_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
