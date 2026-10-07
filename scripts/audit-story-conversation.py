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
SUITCASE_STORY, ANIMATIC = False, False
audit = importlib.import_module("audit-speech-motion-probe")
logger = logging.getLogger("audit-story-conversation")


def main():
    plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    assembly = json.loads((OUT / ("assembly-animatic.json" if ANIMATIC else "assembly.json")).read_text(encoding="utf-8"))
    if SUITCASE_STORY:
        importlib.import_module("prepare-suitcase-story").preflight()
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
        if SUITCASE_STORY and cut["from_still"]:
            reference = shot.get("fallback_reference",shot["reference"]) if not ANIMATIC else shot["reference"]
            image = ROOT / reference["path"]
            assembled = OUT / ("assembled-animatic" if ANIMATIC else "assembled") / f"{shot['id']}.mp4"
            if (hashlib.sha256(image.read_bytes()).hexdigest() != cut["source_sha256"] or
                    hashlib.sha256(assembled.read_bytes()).hexdigest() != cut["assembled_sha256"]):
                raise ValueError("Changed still source or assembled camera-motion take")
            continue
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
    review = OUT / ("review-animatic" if ANIMATIC else "review")
    review.mkdir(exist_ok=True)
    sheet = Image.new("RGB", (1040, ((len(plan["shots"])*3+3)//4)*480), "#151515")
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
        draw.text((x + 4, y + 454), f"{shot['speaker'] or 'ambiente'} {timestamp:.2f}s", fill="white")
    sheet.save(review / "conversation-contact-sheet.jpg", quality=95)
    checkpoints = [json.loads((OUT / s["id"] / "qa.json").read_text(encoding="utf-8"))
        for s,c in zip(plan["shots"],assembly["cuts"],strict=True)
        if not SUITCASE_STORY or (not ANIMATIC and not c["from_still"])]
    workers = sum(qa.get("new_worker_seconds", 0) for qa in checkpoints)
    worker_estimate = sum(qa.get("new_worker_estimate_usd",
        qa.get("new_worker_seconds", 0) * (.001097 + 4 * .0000131 + 64 * .00000222)) for qa in checkpoints)
    report = {"decode_passed": True, "seconds": float(video["duration"]), "fps": 60,
        "frames": int(video["nb_read_frames"]), "width": 704, "height": 1280, "audio_alignment": audio_report,
        "integrated_lufs": loudness, "true_peak_dbfs": peak,
        "max_frame_timestamp_error_seconds": max(errors), "continuous_frame_timestamps": True,
        "sha256": assembly["sha256"], "bytes": path.stat().st_size,
        "new_worker_seconds": workers, "worker_estimate_usd": worker_estimate,
        "aborted_gpu_attempts": assembly.get("aborted_gpu_attempts", 0),
        "hardware_recovery": plan.get("hardware_recovery"),
        "cost_scope": "completed worker estimate; excludes aborted attempt/build/startup/idle; not invoice or balance",
        "lip_sync_validated": False, "human_review_required": True, "published": False,
        "database_writes": False, "production_enabled": False, "synthetic_fiction": True,
        "scope": "artistic preview, not production episode"}
    if SUITCASE_STORY:
        report.update(animatic=ANIMATIC, animated_takes=assembly["animated_takes"], still_takes=assembly["still_takes"],
            scope="new-story artistic preview; digital camera motion on stills, not body animation")
    (OUT / ("conversation-qa-animatic.json" if ANIMATIC else "conversation-qa.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Conversation decode/FPS/cuts/audio transport passed: %.3fs", report["seconds"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    profiles=parser.add_mutually_exclusive_group()
    profiles.add_argument("--guided-acting", action="store_true", help="Audit isolated zero-cloud guided-acting edit")
    profiles.add_argument("--body-acting", action="store_true", help="Audit one new male body-acting take in conversation")
    profiles.add_argument("--suitcase", action="store_true", help="Audit hybrid new-story preview")
    parser.add_argument("--animatic",action="store_true")
    args=parser.parse_args()
    if args.guided_acting:
        OUT = ROOT / "output/guided-acting-conversation"
    elif args.body_acting:
        OUT = ROOT / "output/body-acting-conversation"
    elif args.suitcase:
        OUT = ROOT / "output/suitcase-story-preview"
        SUITCASE_STORY, ANIMATIC = True, args.animatic
    if args.animatic and not args.suitcase: parser.error("Animatic requires the suitcase story")
    main()
