"""Check assembled dialogue timing, decode and review frames; never certifies phonemes."""
import hashlib
import importlib
import json
import logging
from pathlib import Path
import re
import subprocess
import wave
import argparse

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/audio-driven-conversation"
audit = importlib.import_module("audit-speech-motion-probe")
logger = logging.getLogger("audit-story-conversation")


def main():
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    assembly = json.loads((OUT / "assembly.json").read_text(encoding="utf-8"))
    path = OUT / assembly["filename"]
    pcm = []
    for shot, cut in zip(plan["shots"], assembly["cuts"], strict=True):
        if shot["id"] != cut["id"]:
            raise ValueError("Wrong dialogue sequence")
        with wave.open(str(ROOT / shot["audio"])) as voice:
            samples = np.frombuffer(voice.readframes(voice.getnframes()), dtype="<i2")
        count = round(cut["seconds"] * 16000)
        if count < len(samples):
            raise ValueError("Assembled dialogue cuts conditioning voice")
        pcm.append(np.pad(samples, (0, count - len(samples))))
        folder = OUT / shot["id"]
        audit.OUT = folder
        report = json.loads((folder / "qa.json").read_text(encoding="utf-8"))
        results = {name: audit.audit(name, fps, frames, samples.astype(np.float64), path=folder / f"{name}.mp4")
            for name, fps, frames in (("native", 16, shot["frames"]), ("fluid", 60, shot["output_frames"]))}
        (folder / "av-audit.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        if hashlib.sha256((folder / "fluid.mp4").read_bytes()).hexdigest() != report["outputs"]["fluid"]["sha256"]:
            raise ValueError("Shot changed")
    reference = np.concatenate(pcm).astype(np.float64)
    if hashlib.sha256(path.read_bytes()).hexdigest() != assembly["sha256"]:
        raise ValueError("Assembled video changed")
    details = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_streams",
        "-show_format", "-of", "json", str(path)], timeout=60))
    video = next(s for s in details["streams"] if s["codec_type"] == "video")
    audio = next(s for s in details["streams"] if s["codec_type"] == "audio")
    if video["avg_frame_rate"] != "60/1" or int(video["nb_read_frames"]) != assembly["expected_frames"]:
        raise ValueError("Assembled frame timing changed")
    if (video["width"], video["height"], video["codec_name"], audio["codec_name"]) != (704, 1280, "h264", "aac"):
        raise ValueError("Unexpected delivery format")
    if abs(float(video["duration"]) - assembly["seconds"]) > .02:
        raise ValueError("Assembled duration drift")
    if abs(float(video.get("start_time", 0))) > .001 or abs(float(audio.get("start_time", 0))) > .02:
        raise ValueError("Assembled A/V origins differ")
    timeline = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path)], timeout=60))["frames"]
    errors = [abs(float(frame["best_effort_timestamp_time"]) - index / 60) for index, frame in enumerate(timeline)]
    if len(errors) != assembly["expected_frames"] or max(errors) > .00001:
        raise ValueError("Frame timestamp gap/duplicate across cuts; average FPS alone is insufficient")
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True, timeout=60)
    audio_report = audit.audio_alignment(path, reference)
    levels = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af",
        "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True, check=True, timeout=60).stderr
    integrated = re.findall(r"I:\s*(-?[\d.]+) LUFS", levels)
    peaks = re.findall(r"Peak:\s*(-?[\d.]+) dBFS", levels)
    if not integrated or not peaks:
        raise ValueError("Audio level measurement missing")
    loudness, peak = float(integrated[-1]), float(peaks[-1])
    if peak > -.5 or not -18 <= loudness <= -14:
        raise ValueError("Clipping or unsuitable preview narration level")
    review = OUT / "review"
    review.mkdir(exist_ok=True)
    sheet = Image.new("RGB", (1040, 1440), "#151515")
    draw = ImageDraw.Draw(sheet)
    for index, (shot, cut, portion) in enumerate((s, c, p) for s, c in zip(plan["shots"], assembly["cuts"], strict=True) for p in (.1, .5, .9)):
        timestamp = cut["start_seconds"] + cut["seconds"] * portion
        target = review / f"{shot['id']}-{portion:.1f}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(timestamp), "-i", str(path),
            "-frames:v", "1", str(target)], check=True, timeout=30)
        frame = Image.open(target).convert("RGB")
        frame.thumbnail((256, 450))
        x, y = index % 4 * 260, index // 4 * 480
        sheet.paste(frame, (x, y))
        draw.text((x + 4, y + 454), f"{shot['speaker']} {timestamp:.2f}s", fill="white")
    sheet.save(review / "conversation-contact-sheet.jpg", quality=95)
    workers = sum(json.loads((OUT / s["id"] / "qa.json").read_text(encoding="utf-8")).get("new_worker_seconds", 0) for s in plan["shots"])
    report = {"decode_passed": True, "seconds": float(video["duration"]), "fps": 60,
        "frames": int(video["nb_read_frames"]), "width": 704, "height": 1280, "audio_alignment": audio_report,
        "integrated_lufs": loudness, "true_peak_dbfs": peak,
        "max_frame_timestamp_error_seconds": max(errors), "continuous_frame_timestamps": True,
        "sha256": assembly["sha256"], "bytes": path.stat().st_size,
        "new_worker_seconds": workers, "worker_estimate_usd": workers * (.001097 + 4 * .0000131 + 64 * .00000222),
        "cost_scope": "worker estimate, excludes build/startup/idle, not invoice or balance",
        "lip_sync_validated": False, "human_review_required": True, "published": False,
        "database_writes": False, "production_enabled": False, "synthetic_fiction": True,
        "scope": "artistic preview, not production episode"}
    (OUT / "conversation-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Conversation decode/FPS/cuts/audio transport passed: %.3fs", report["seconds"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--guided-acting", action="store_true", help="Audit isolated zero-cloud guided-acting edit")
    if parser.parse_args().guided_acting:
        OUT = ROOT / "output/guided-acting-conversation"
    main()
