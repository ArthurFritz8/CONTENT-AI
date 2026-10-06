"""Measure transport timing and fluidity, without claiming phonetic lip-sync QA."""
import hashlib
import json
import logging
from pathlib import Path
import subprocess
import wave

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/audio-driven-motion-probe"
logger = logging.getLogger("audit-speech-motion")


def audio_alignment(path: Path, reference: np.ndarray):
    data = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
        "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"], timeout=60)
    decoded = np.frombuffer(data, dtype="<i2").astype(np.float64)
    decoded -= decoded.mean()
    ref = reference - reference.mean()
    size = 1 << (len(ref) + len(decoded) - 1).bit_length()
    correlation = np.fft.irfft(np.fft.rfft(decoded, size) * np.fft.rfft(ref[::-1], size), size)
    centre = len(ref) - 1
    peak = int(np.argmax(correlation[centre - 8000:centre + 8001])) + centre - 8000
    lag = peak - centre
    # Compare aligned overlap; codec delay alone must not create an apparent "lip-sync pass".
    left = max(0, lag)
    right = max(0, -lag)
    count = min(len(decoded) - left, len(ref) - right)
    similarity = float(np.corrcoef(decoded[left:left + count], ref[right:right + count])[0, 1])
    if abs(lag / 16000) > 0.02 or similarity < 0.98:
        raise ValueError("Muxed narration shifted or does not match the conditioning audio")
    return {"measured_audio_lag_seconds": lag / 16000, "pcm_correlation": similarity,
        "decoded_audio_seconds": len(decoded) / 16000, "scope": "audio transport only; not lip-sync"}


def audit(name, expected_fps, expected_count, reference):
    path = OUT / f"malu-{name}.mp4"
    details = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames",
        "-show_streams", "-show_format", "-of", "json", str(path)], timeout=60))
    video = next(s for s in details["streams"] if s["codec_type"] == "video")
    audio = next(s for s in details["streams"] if s["codec_type"] == "audio")
    numerator, denominator = map(int, video["avg_frame_rate"].split("/"))
    fps = numerator / denominator
    count = int(video["nb_read_frames"])
    if fps != expected_fps or count != expected_count or video["codec_name"] != "h264" or audio["codec_name"] != "aac":
        raise ValueError("Unexpected codec/frame contract")
    if abs(float(video.get("start_time", 0))) > .001 or abs(float(audio.get("start_time", 0))) > .02:
        raise ValueError("Audio/video do not share the expected zero time origin")
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True, timeout=60)
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0", "-vf",
        "scale=128:224", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"], timeout=60)
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 224, 128)
    if len(frames) != count:
        raise ValueError("Decode frame count differs")
    unique = len({hashlib.sha256(frame.tobytes()).digest() for frame in frames})
    changes = np.abs(np.diff(frames.astype(np.float32), axis=0)).mean(axis=(1, 2))
    report = {"fps": fps, "decoded_frames": count, "distinct_decoded_frames_at_128x224": unique,
        "width": video["width"], "height": video["height"], "video_seconds": float(video["duration"]),
        "audio_start_seconds": float(audio.get("start_time", 0)),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "mean_adjacent_pixel_change": float(changes.mean()),
        "p95_adjacent_pixel_change": float(np.quantile(changes, .95)),
        "fully_identical_adjacent_frames": int(np.sum(changes == 0)),
        "audio_alignment": audio_alignment(path, reference), "decode_passed": True,
        "lip_sync_validated": False, "artistic_review_required": True}
    review = OUT / "review"
    review.mkdir(exist_ok=True)
    times = [0.10, 0.40, 0.95, 1.45, 1.62, 1.88, 2.08, 2.38, 2.67, 3.04, 3.32, 3.65]
    sheet = Image.new("RGB", (4 * 260, 3 * 480), "#151515")
    draw = ImageDraw.Draw(sheet)
    for index, timestamp in enumerate(times):
        target = review / f"{name}-{timestamp:.2f}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(timestamp), "-i", str(path),
            "-frames:v", "1", str(target)], check=True, timeout=30)
        frame = Image.open(target).convert("RGB")
        frame.thumbnail((256, 450))
        x, y = (index % 4) * 260, (index // 4) * 480
        sheet.paste(frame, (x, y))
        draw.text((x + 5, y + 454), f"{name} {timestamp:.2f}s", fill="white")
    sheet.save(review / f"{name}-contact-sheet.jpg", quality=95)
    return report


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    qa = json.loads((OUT / "qa.json").read_text(encoding="utf-8"))
    with wave.open(str(OUT / "voice.wav")) as wav:
        reference = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float64)
    results = {"native": audit("native", qa["native_fps"], qa["native_frames"], reference),
        "fluid": audit("fluid", qa["output_fps"], qa["output_frames"], reference),
        "note": "Timing and frame metrics do not verify phonemes, acting or interpolation artifacts."}
    (OUT / "av-audit.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Decode, timing, FPS and reference audio checks passed; lip-sync still requires review")
