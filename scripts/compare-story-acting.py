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


def validate_direction(baseline, baseline_inputs, new, inputs):
    previous = baseline.get("acting_prompt", baseline_inputs["prompt"])
    if new["acting_prompt"] != inputs["prompt"]:
        raise ValueError("Direction differs from experiment manifest")
    if inputs["experiment"] == "arm-gesture-pose-v2":
        if (new["acting_prompt"] != previous or not baseline.get("pose_conditioned") or
            not new.get("pose_conditioned") or new.get("pose_sha256") == baseline.get("pose_sha256")):
            raise ValueError("Gesture-only comparison must keep the prompt and change an existing pose")
        return ["pose_trajectory"]
    if new["acting_prompt"] == previous:
        raise ValueError("New acting direction did not change")
    return ["acting_prompt"] + (["pose_conditioning"] if inputs.get("pose_conditioned") else [])


def compare(body_acting=False):
    baseline = json.loads((BASE / "qa.json").read_text(encoding="utf-8"))
    new = json.loads((OUT / "qa.json").read_text(encoding="utf-8"))
    if body_acting:
        probe=importlib.import_module("modal-speech-motion-probe")
        male=importlib.import_module("test-story-body-acting")
        plan=json.loads((OUT.parent/"plan.json").read_text(encoding="utf-8"))
        request=male.request_for(plan)
        male.verify(new,request)
        baseline_inputs={"prompt":baseline["acting_prompt"],"negative_prompt":probe.NEGATIVE}
        inputs={"prompt":plan["shots"][0]["prompt"],"negative_prompt":plan["negative_prompt"],
            "experiment":"male-body-acting-v1","baseline_sha256":baseline["outputs"]["fluid"]["sha256"],
            "pose_conditioned":True,"pose_sha256":plan["shots"][0]["pose_sha256"],"audio_sha256":request["audio_sha"]}
        voice_path=ROOT/plan["shots"][0]["audio"]
        reference_path=ROOT/plan["shots"][0]["reference"]["path"]
        clip_prefix=""
    else:
        baseline_inputs = json.loads((BASE / "input.json").read_text(encoding="utf-8"))
        inputs = json.loads((OUT / "input.json").read_text(encoding="utf-8"))
        voice_path=OUT/"voice.wav"
        reference_path=ROOT/"output/humanized-story-pilot/references/malu-close-v1.png"
        clip_prefix="malu-"
    fixed = ("input_audio_sha256", "reference_sha256", "seed", "steps", "native_frames", "native_fps",
        "output_fps", "output_frames", "width", "height", "model_revision", "wan_commit",
        "rife_revision", "rife_weights_sha256")
    if any(new[key] != baseline[key] for key in fixed):
        raise ValueError("Comparison changed a fixed image/audio/model/frame parameter")
    if baseline_inputs["negative_prompt"] != inputs["negative_prompt"]:
        raise ValueError("Negative direction changed between the two experiments")
    changed = validate_direction(baseline, baseline_inputs, new, inputs)
    if inputs["baseline_sha256"] != baseline["outputs"]["fluid"]["sha256"]:
        raise ValueError("Baseline differs from the prepared comparison")
    if (BASE / "voice.wav").read_bytes() != voice_path.read_bytes():
        raise ValueError("Original conditioning voice changed")
    pose_controlled = inputs.get("pose_conditioned",False)
    if new.get("pose_conditioned",False) != pose_controlled:
        raise ValueError("Pose conditioning differs from prepared experiment")
    if pose_controlled and new.get("pose_sha256") != inputs.get("pose_sha256"):
        raise ValueError("Worker used a different pose guide")
    validate_inputs(reference_path.read_bytes(), voice_path.read_bytes(), inputs["audio_sha256"],
        frames=new["native_frames"],reference_sha=new["reference_sha256"])
    with wave.open(str(voice_path)) as voice:
        reference = np.frombuffer(voice.readframes(voice.getnframes()), dtype="<i2").astype(np.float64)
    audits = {}
    for label, folder, qa in (("baseline", BASE, baseline), ("expressive", OUT, new)):
        audits[label] = {}
        for name, fps, count in (("native", 16, new["native_frames"]), ("fluid", 60, new["output_frames"])):
            path = folder / f"{clip_prefix}{name}.mp4"
            if digest(path) != qa["outputs"][name]["sha256"]:
                raise ValueError("Video checksum differs")
            audits[label][name] = auditor.audit(name, fps, count, reference, path=path)
    # Labels only: identical dimensions/timestamps, no zoom, retime, or extra interpolation.
    font = "C\\:/Windows/Fonts/arial.ttf"
    if not Path("C:/Windows/Fonts/arial.ttf").exists():
        raise ValueError("Comparison font unavailable; do not silently change layout")
    label = "Corpo guiado" if body_acting else "Gesto ampliado" if changed==["pose_trajectory"] else "Pose guiada" if pose_controlled else "Atuacao nova"
    baseline_label = "Gesto aprovado" if changed==["pose_trajectory"] else "Anterior"
    filters = (
        f"[0:v]pad=iw:ih+80:0:80:color=0x141414,drawtext=fontfile='{font}':"
        f"text='{baseline_label}':fontsize=36:fontcolor=white:x=30:y=18[old];"
        f"[1:v]pad=iw:ih+80:0:80:color=0x141414,drawtext=fontfile='{font}':"
        f"text='{label}':fontsize=36:fontcolor=white:x=30:y=18[new];"
        "[old][new]hstack=shortest=1[v]"
    )
    comparison = OUT / "comparacao-gestos.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-copyts", "-i", str(BASE / f"{clip_prefix}fluid.mp4"),
        "-i", str(OUT / f"{clip_prefix}fluid.mp4"), "-filter_complex", filters, "-map", "[v]", "-map", "0:a:0",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-fps_mode", "passthrough", "-c:a", "copy", "-avoid_negative_ts", "disabled",
        "-movflags", "+faststart", str(comparison)], check=True, timeout=120)
    audits["comparison"] = auditor.audit("comparison", 60, new["output_frames"], reference, path=comparison)
    measured_seconds = new.get("worker_entry_seconds",new["worker_seconds"])
    report = {"experiment": inputs["experiment"], "changed": changed,
        "pose_conditioned":pose_controlled,"pose_sha256":new.get("pose_sha256"),"fixed_parameters": list(fixed),
        "baseline_direction_source": "qa.json" if "acting_prompt" in baseline else "input.json (historic baseline manifest)",
        "audits": audits, "worker_seconds": new["worker_seconds"],
        "worker_entry_seconds":new.get("worker_entry_seconds"),"stage_seconds":new.get("stage_seconds"),
        "gpu_name": new.get("gpu_name"),
        "estimated_worker_cost_usd": measured_seconds * (float(male.RATE) if body_acting else
            (.001097 + 4 * .0000131 + 64 * .00000222)),
        "cost_scope": "worker entry including imports/validation if measured; excludes image build/boot/transport/idle; not invoice or balance",
        "lip_sync_validated": False, "human_review_required": True, "acting_improvement_validated": False,
        "production_enabled": False, "published": False,
        "note": "Pixel variation and frame counts do not prove improved acting; compare visually.",
        **({"hardware_recovery": plan.get("hardware_recovery"),
            "hardware_comparison_controlled": False} if body_acting else {})}
    (OUT / "comparison-qa.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Same image/voice/seed/config, decode and timing verified; compare acting visually: %s", comparison)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    profile=parser.add_mutually_exclusive_group()
    profile.add_argument("--pose-controlled",action="store_true")
    profile.add_argument("--arm-gesture",action="store_true")
    profile.add_argument("--body-acting",action="store_true")
    args=parser.parse_args()
    if args.pose_controlled:
        OUT = ROOT / "output/stable-hands-motion-probe"
    if args.arm_gesture:
        BASE=ROOT/"output/stable-hands-motion-probe"
        OUT=ROOT/"output/arm-gesture-motion-probe"
    if args.body_acting:
        BASE=ROOT/"output/audio-driven-conversation/06"
        OUT=ROOT/"output/body-acting-conversation/06"
    compare(args.body_acting)
