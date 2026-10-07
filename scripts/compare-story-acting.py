"""Audit an isolated acting experiment and assemble a timestamp-matched comparison."""
import hashlib
import importlib
import json
import logging
from pathlib import Path
import subprocess
import wave
import argparse

import numpy as np
from story_motion_contract import validate_inputs

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "output/audio-driven-motion-probe"
OUT = ROOT / "output/expressive-speech-motion-probe"
auditor = importlib.import_module("audit-speech-motion-probe")
logger = logging.getLogger("compare-story-acting")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare():
    baseline = json.loads((BASE / "qa.json").read_text(encoding="utf-8"))
    baseline_inputs = json.loads((BASE / "input.json").read_text(encoding="utf-8"))
    new = json.loads((OUT / "qa.json").read_text(encoding="utf-8"))
    inputs = json.loads((OUT / "input.json").read_text(encoding="utf-8"))
    fixed = ("input_audio_sha256", "reference_sha256", "seed", "steps", "native_frames", "native_fps",
        "output_fps", "output_frames", "width", "height", "model_revision", "wan_commit",
        "rife_revision", "rife_weights_sha256")
    if any(new[key] != baseline[key] for key in fixed):
        raise ValueError("Comparison changed a fixed image/audio/model/frame parameter")
    baseline_prompt = baseline.get("acting_prompt", baseline_inputs["prompt"])
    if baseline_inputs["negative_prompt"] != inputs["negative_prompt"]:
        raise ValueError("Negative direction changed between the two experiments")
    if new["acting_prompt"] != inputs["prompt"] or new["acting_prompt"] == baseline_prompt:
        raise ValueError("New direction is missing or differs from the experiment manifest")
    if inputs["baseline_sha256"] != baseline["outputs"]["fluid"]["sha256"]:
        raise ValueError("Baseline differs from the prepared comparison")
    if (BASE / "voice.wav").read_bytes() != (OUT / "voice.wav").read_bytes():
        raise ValueError("Original conditioning voice changed")
    pose_controlled = inputs.get("pose_conditioned",False)
    if new.get("pose_conditioned",False) != pose_controlled:
        raise ValueError("Pose conditioning differs from prepared experiment")
    if pose_controlled and new.get("pose_sha256") != inputs.get("pose_sha256"):
        raise ValueError("Worker used a different pose guide")
    validate_inputs((ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes(),
        (OUT / "voice.wav").read_bytes(), inputs["audio_sha256"])
    with wave.open(str(OUT / "voice.wav")) as voice:
        reference = np.frombuffer(voice.readframes(voice.getnframes()), dtype="<i2").astype(np.float64)
    audits = {}
    for label, folder, qa in (("baseline", BASE, baseline), ("expressive", OUT, new)):
        audits[label] = {}
        for name, fps, count in (("native", 16, 64), ("fluid", 60, 237)):
            path = folder / f"malu-{name}.mp4"
            if digest(path) != qa["outputs"][name]["sha256"]:
                raise ValueError("Video checksum differs")
            audits[label][name] = auditor.audit(name, fps, count, reference, path=path)
    # Labels only: identical dimensions/timestamps, no zoom, retime, or extra interpolation.
    font = "C\\:/Windows/Fonts/arial.ttf"
    if not Path("C:/Windows/Fonts/arial.ttf").exists():
        raise ValueError("Comparison font unavailable; do not silently change layout")
    label = "Pose guiada" if pose_controlled else "Atuacao nova"
    filters = (
        f"[0:v]pad=iw:ih+80:0:80:color=0x141414,drawtext=fontfile='{font}':"
        "text='Anterior':fontsize=36:fontcolor=white:x=30:y=18[old];"
        f"[1:v]pad=iw:ih+80:0:80:color=0x141414,drawtext=fontfile='{font}':"
        f"text='{label}':fontsize=36:fontcolor=white:x=30:y=18[new];"
        "[old][new]hstack=shortest=1[v]"
    )
    comparison = OUT / "comparacao-gestos.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-copyts", "-i", str(BASE / "malu-fluid.mp4"),
        "-i", str(OUT / "malu-fluid.mp4"), "-filter_complex", filters, "-map", "[v]", "-map", "0:a:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-fps_mode", "passthrough", "-c:a", "copy", "-avoid_negative_ts", "disabled",
        "-movflags", "+faststart", str(comparison)], check=True, timeout=120)
    audits["comparison"] = auditor.audit("comparison", 60, 237, reference, path=comparison)
    report = {"experiment": inputs["experiment"], "changed": ["acting_prompt"] + (["pose_conditioning"] if pose_controlled else []),
        "pose_conditioned":pose_controlled,"pose_sha256":new.get("pose_sha256"),"fixed_parameters": list(fixed),
        "baseline_direction_source": "qa.json" if "acting_prompt" in baseline else "input.json (historic baseline manifest)",
        "audits": audits, "worker_seconds": new["worker_seconds"],
        "estimated_worker_cost_usd": new["worker_seconds"] * (.001097 + 4 * .0000131 + 64 * .00000222),
        "cost_scope": "worker only; excludes build/startup/idle; not invoice or balance",
        "lip_sync_validated": False, "human_review_required": True, "acting_improvement_validated": False,
        "production_enabled": False, "published": False,
        "note": "Pixel variation and frame counts do not prove improved acting; compare visually."}
    (OUT / "comparison-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Same image/voice/seed/config, decode and timing verified; compare acting visually: %s", comparison)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pose-controlled",action="store_true")
    if parser.parse_args().pose_controlled:
        OUT = ROOT / "output/stable-hands-motion-probe"
    compare()
