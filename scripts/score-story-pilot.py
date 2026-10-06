"""An original quiet plucked score: comic curiosity becomes a family mystery."""
import argparse
import json
from pathlib import Path
import wave
import numpy as np

root = Path(__file__).resolve().parents[1]
out = root / "output/humanized-story-pilot"
plan = json.loads((out / "plan.json").read_text(encoding="utf-8"))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--edited", action="store_true", help="Use the assembler's measured trailing-silence cuts")
if parser.parse_args().edited:
    cuts = json.loads((out / "editing-cuts.json").read_text(encoding="utf-8"))["cuts"]
    if len(cuts) != len(plan["shots"]):
        raise ValueError("Incomplete edit timings")
    for shot, cut in zip(plan["shots"], cuts):
        if shot["id"] != cut["shot"] or abs(shot["audio_seconds"] - cut["raw_audio_seconds"]) > 0.001 or \
            not 0 < cut["audio_seconds"] <= shot["audio_seconds"]:
            raise ValueError("Edit timing differs from the measured plan")
        shot["audio_seconds"] = cut["audio_seconds"]
    plan["measured_duration_seconds"] = sum(s["audio_seconds"] + s["gap_seconds"] for s in plan["shots"])
rate = 44100
duration = plan["measured_duration_seconds"] + 2
score = np.zeros(int(duration * rate), dtype=np.float64)
chords = [(57, 60, 64), (53, 57, 60), (55, 59, 62), (52, 55, 59)]
for index, start in enumerate(np.arange(0, duration, 0.9)):
    tense = start > duration * 0.64
    chord = chords[(index // 8) % len(chords)] if not tense else [(52, 55, 59), (53, 57, 60)][(index // 8) % 2]
    note = chord[index % 3] + (12 if index % 4 else 0)
    frequency = 440 * 2 ** ((note - 69) / 12)
    t = np.arange(int(2 * rate)) / rate
    envelope = (1 - np.exp(-t * 70)) * np.exp(-t * (3.4 if not tense else 2.4))
    tone = envelope * (np.sin(2 * np.pi * frequency * t) + 0.25 * np.sin(2 * np.pi * frequency * 2 * t)) * (0.11 if not tense else 0.08)
    offset = int(start * rate)
    count = min(len(tone), len(score) - offset)
    score[offset:offset + count] += tone[:count]
# An original rising reveal accent, without a jump scare or borrowed sample.
reveal = sum(s["audio_seconds"] + s["gap_seconds"] for s in plan["shots"][:15])
for note in (45, 52, 59):
    t = np.arange(int(2.6 * rate)) / rate
    tone = np.sin(2 * np.pi * 440 * 2 ** ((note - 69) / 12) * t) * np.sin(np.minimum(t / 2.6, 1) * np.pi) * 0.035
    offset = int(reveal * rate)
    score[offset:offset + len(tone)] += tone
timeline = np.arange(len(score)) / rate
# Keep two seconds of silent headroom for mux rounding, but finish the musical
# fade at the measured chapter end, rather than beyond the final video.
fade = np.minimum(timeline / 1.2, 1) * np.clip((plan["measured_duration_seconds"] - timeline) / 2, 0, 1)
score = np.clip(score * fade, -0.7, 0.7)
with wave.open(str(out / "original-score.wav"), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(rate)
    audio.writeframes((score * 32767).astype("<i2").tobytes())
(out / "score-license.json").write_text(json.dumps({"license": "own", "source": "system", "creator": "original procedural composition",
    "external_samples": False, "duration_seconds": duration,
    "fade_out_ends_at_seconds": plan["measured_duration_seconds"]}), encoding="utf-8")
