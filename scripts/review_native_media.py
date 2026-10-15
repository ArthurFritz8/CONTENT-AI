"""Offline hints for human review. Never edits video, approves a chapter or calls a generation API."""
from pathlib import Path
import argparse
import colorsys
import datetime
import difflib
import hashlib
import json
import math
import os
import re
import subprocess
import unicodedata

MODEL_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"


def tokens(text):
    return re.findall(r"[a-z0-9]+", "".join(c for c in unicodedata.normalize("NFD", text.casefold()) if unicodedata.category(c) != "Mn"))


def speech_status(expected, recognized):
    a, b = tokens(expected), tokens(recognized)
    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    edits = matcher.get_opcodes()
    if any(tag in ("delete", "replace") for tag, *_ in edits):
        return "possible_missing_speech"
    if any(tag == "insert" for tag, *_ in edits):
        return "possible_extra_speech"
    return "no_mismatch_detected"


def checked_bytes(path, expected):
    path = Path(path).resolve()
    if not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("Invalid local media")
    data = path.read_bytes()
    if not re.fullmatch(r"[a-f0-9]{64}", expected) or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Media identity changed")
    return path


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, timeout=45)
    if result.returncode:
        raise ValueError("Media could not be decoded")
    return result.stdout


def color_signature(rgb, width=96, height=168):
    """Lower central area, chromatic pixels only; pose/lighting can still cause false positives."""
    bins, count, total = [0] * 12, 0, 0
    for y in range(round(height * .60), round(height * .90)):
        for x in range(round(width * .22), round(width * .78)):
            pos = (y * width + x) * 3
            r, g, b = [v / 255 for v in rgb[pos:pos + 3]]
            hue, sat, value = colorsys.rgb_to_hsv(r, g, b)
            total += 1
            if sat >= .28 and .15 <= value <= .97:
                bins[min(11, int(hue * 12))] += 1
                count += 1
    return ([v / count for v in bins] if count else bins), count / total


def color_distance(a, b):
    return math.sqrt(sum((math.sqrt(x) - math.sqrt(y)) ** 2 for x, y in zip(a, b)) / 2)


def appearance(path):
    width, height = 96, 168
    frames = []
    for second in [0, .75, 1.75, 2.75, 3.75, 4.75]:
        raw = run(["ffmpeg", "-v", "error", "-ss", str(second), "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:{height}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"])
        if len(raw) != width * height * 3:
            raise ValueError("Frame unavailable")
        frames.append(color_signature(raw, width, height))
    base, coverage = frames[0]
    scores = [color_distance(base, sig) for sig, amount in frames[1:] if coverage >= .06 and amount >= .06]
    score = max(scores, default=0)
    shifted = sum(s >= .40 for s in scores) >= 3
    return {"appearance_status": "possible_color_shift" if shifted else "no_color_shift_detected", "sampled_frames": len(frames), "color_shift_score": round(score, 6)}


def load_speech_model():
    # The separate setup command downloads public weights; this process is offline.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    from huggingface_hub import snapshot_download
    from faster_whisper import WhisperModel
    snapshot = snapshot_download("Systran/faster-whisper-base", revision=MODEL_REVISION, token=False, local_files_only=True,
                                 allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"])
    return WhisperModel(snapshot, device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)


def transcribe(model, path):
    import numpy as np
    raw = run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"])
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    segments, _ = model.transcribe(samples, language="pt", beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=False)
    return " ".join(s.text.strip() for s in segments)[:600]


def review(manifest):
    if len(manifest["takes"]) != 3:
        raise ValueError("Three frozen takes required")
    checked_bytes(manifest["video_path"], manifest["video_sha256"])
    try:
        model = load_speech_model()
    except Exception:
        model = None
    takes = []
    for index, take in enumerate(manifest["takes"]):
        path = checked_bytes(take["path"], take["sha256"])
        result = {"index": index, "speaker": take["speaker"], "sha256": take["sha256"], "expected_text": take["expected_text"],
                  "recognized_text": "", "speech_status": "unavailable", "appearance_status": "unavailable", "sampled_frames": 0, "color_shift_score": None}
        try:
            result.update(appearance(path))
        except Exception:
            pass
        if model is not None:
            try:
                result["recognized_text"] = transcribe(model, path)
                result["speech_status"] = speech_status(take["expected_text"], result["recognized_text"])
            except Exception:
                pass
        takes.append(result)
    return {"version": "native-media-review-v1", "episode_id": manifest["episode_id"], "video_sha256": manifest["video_sha256"],
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"), "speech_engine": "faster-whisper-base-cpu" if model is not None else "unavailable",
            "model_revision": MODEL_REVISION, "human_review_required": True, "lip_sync_verified": False, "identity_verified": False, "source_video_unchanged": True, "takes": takes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    if args.manifest.stat().st_size > 32768:
        raise SystemExit("Manifest too large")
    print(json.dumps(review(json.loads(args.manifest.read_text(encoding="utf-8"))), ensure_ascii=False))
