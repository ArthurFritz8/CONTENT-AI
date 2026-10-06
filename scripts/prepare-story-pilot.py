"""Prepare measured speech and a bounded shot plan; creates no database episode."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/humanized-story-pilot"


def prepare():
    plan = json.loads((ROOT / "docs/stories/pilot-01-malu-laranjito.json").read_text(encoding="utf-8"))
    refs = {
        "wide": ROOT / "output/humanized-fruit-concept/malu-laranjito-concept-v1.png",
        "malu": OUT / "references/malu-close-v1.png",
        "laranjito": OUT / "references/laranjito-close-v1.png",
    }
    plan["references"] = {key: {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "source": "system", "origin": "session_imagegen", "license": "generated"} for key, path in refs.items()}
    for shot in plan["shots"]:
        audio = OUT / "audio" / f"{shot['id']}.mp3"
        bounds = audio.with_suffix(".words.json")
        audio.parent.mkdir(parents=True, exist_ok=True)
        voice = "pt-BR-FranciscaNeural" if shot["speaker"] == "malu" else "pt-BR-AntonioNeural"
        payload = {"text": shot["text"], "voice": voice, "rate": "+0%", "audio": str(audio), "boundaries": str(bounds)}
        cache = audio.with_suffix(".request.json")
        if not (audio.exists() and bounds.exists() and cache.exists() and json.loads(cache.read_text(encoding="utf-8")) == payload):
            subprocess.run([sys.executable, str(ROOT / "scripts/synthesize-edge.py")], input=json.dumps(payload).encode("utf-8"), check=True, timeout=90)
            cache.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(audio)]))
        shot.update({"audio": str(audio.relative_to(ROOT)), "words": str(bounds.relative_to(ROOT)), "voice": voice,
            "audio_seconds": duration, "gap_seconds": 0.25,
            "frames": 4 * math.ceil((math.ceil((duration + 0.25) * 24) - 1) / 4) + 1,
            "seed": 1000 + int(shot["id"])})
        if not 49 <= shot["frames"] <= 241:
            raise ValueError(f"Shot {shot['id']} outside the bounded frame contract: {shot['frames']}")
        print(f"shot={shot['id']} voice={voice} audio={duration:.3f}s frames={shot['frames']}", flush=True)
    plan["measured_duration_seconds"] = sum(s["audio_seconds"] + s["gap_seconds"] for s in plan["shots"])
    if plan["measured_duration_seconds"] < 60:
        raise ValueError("Narration needs enrichment before video generation")
    (OUT / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Measured episode: {plan['measured_duration_seconds']:.3f}s", flush=True)


if __name__ == "__main__":
    prepare()
