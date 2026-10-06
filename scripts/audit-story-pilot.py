"""Technical audit and review frames for the isolated episode; no art auto-approval."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/humanized-story-pilot"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--final", action="store_true", help="Also measure the assembled chapter's audio")
args = parser.parse_args()
plan = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
review = OUT / "review"
review.mkdir(exist_ok=True)
rows = []
for shot in plan["shots"]:
    video = OUT / "clips" / f"{shot['id']}.mp4"
    metadata = video.with_suffix(".json")
    if not metadata.exists():
        continue
    checkpoint = json.loads(metadata.read_text(encoding="utf-8"))
    assert hashlib.sha256(video.read_bytes()).hexdigest() == checkpoint["sha256"]
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]))
    stream = probe["streams"][0]
    assert len(probe["streams"]) == 1 and stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p"
    assert stream["width"] == 704 and stream["height"] == 1248 and int(stream["nb_frames"]) == shot["frames"]
    assert float(stream["duration"]) + 0.001 >= shot["audio_seconds"] + shot["gap_seconds"]
    boundaries = json.loads((ROOT / shot["words"]).read_text(encoding="utf-8"))
    assert boundaries and all(0 <= b["offset_seconds"] < b["offset_seconds"] + b["duration_seconds"] <= shot["audio_seconds"] + 0.04 for b in boundaries)
    row = {"shot": shot["id"], "technical_passed": True, "speaker": shot["speaker"], "reference": shot["reference"],
        "seconds": float(stream["duration"]), "worker_seconds": checkpoint["report"]["worker_seconds"]}
    motion_path = review / f"{shot['id']}-motion.json"
    motion = json.loads(motion_path.read_text(encoding="utf-8")) if motion_path.exists() else None
    if motion is None or motion["sha256"] != checkpoint["sha256"]:
        hashes = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(video),
            "-map", "0:v:0", "-f", "framemd5", "-"], text=True, timeout=60)
        frames = [line.rsplit(",", 1)[1].strip() for line in hashes.splitlines() if line and not line.startswith("#")]
        motion = {"sha256": checkpoint["sha256"], "decoded_frames": len(frames), "distinct_frames": len(set(frames))}
        motion_path.write_text(json.dumps(motion), encoding="utf-8")
    assert motion["decoded_frames"] == shot["frames"] and motion["distinct_frames"] > 1
    row.update({"decoded_frames": motion["decoded_frames"], "distinct_frames": motion["distinct_frames"]})
    for label, seconds in (("start", 0), ("mid", float(stream["duration"]) / 2), ("end", max(0, float(stream["duration"]) - 0.15))):
        target = review / f"{shot['id']}-{label}.jpg"
        if not target.exists():
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(seconds), "-i", str(video),
                "-vf", "scale=320:-1", "-frames:v", "1", str(target)], check=True, capture_output=True)
    rows.append(row)
rate = 0.001097 + 4 * 0.0000131 + 24 * 0.00000222
report = {"completed": len(rows), "total": len(plan["shots"]), "shots": rows,
    "worker_seconds_total": sum(r["worker_seconds"] for r in rows),
    "worker_resource_cost_estimate_usd": sum(r["worker_seconds"] for r in rows) * rate,
    "price_source": "https://modal.com/pricing", "price_checked": "2026-10-06",
    "estimate_excludes": "container startup outside timer, idle, image preparation, failed attempts, transfer and actual invoice rounding",
    "invoice_queried": False, "art_automatically_approved": False, "lip_sync_validated": False}
(OUT / "shot-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({key: report[key] for key in ("completed", "total", "worker_seconds_total", "worker_resource_cost_estimate_usd")}, indent=2))
if args.final:
    if len(rows) != len(plan["shots"]):
        raise ValueError("Final audio audit requires every shot")
    final = OUT / "episodio-01-o-biscoito-e-o-segredo.mp4"
    loudness = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(final), "-vn",
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        check=True, capture_output=True, text=True, timeout=120)
    measured, _ = json.JSONDecoder().raw_decode(loudness.stderr[loudness.stderr.rfind("{"):])
    integrated, peak = float(measured["input_i"]), float(measured["input_tp"])
    if not math.isfinite(integrated) or abs(integrated + 16) > 1 or not math.isfinite(peak) or peak > -0.9:
        raise ValueError(f"Audio levels require review: {integrated} LUFS, {peak} dBTP")
    silence = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(OUT / "dialogue.mp4"), "-vn",
        "-af", "silencedetect=noise=-45dB:d=1", "-f", "null", "-"],
        check=True, capture_output=True, text=True, timeout=120)
    intervals = [float(value) for value in re.findall(r"silence_duration: ([\d.]+)", silence.stderr)]
    audio_report = {"integrated_lufs": integrated, "true_peak_dbtp": peak,
        "loudness_range_lu": float(measured["input_lra"]), "technical_levels_passed": True,
        "dry_dialogue_silences_over_one_second": intervals, "silence_review_required": bool(intervals),
        "silence_is_not_a_phonetic_or_music_balance_check": True,
        "human_listening_pending": True, "lip_sync_validated": False,
        "final_sha256": hashlib.sha256(final.read_bytes()).hexdigest()}
    (OUT / "audio-qa.json").write_text(json.dumps(audio_report, indent=2), encoding="utf-8")
    print(json.dumps(audio_report, indent=2))
