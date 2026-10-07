"""Reuse the existing PCM alignment audit; no cloud requests or credentials."""
import importlib
import json
from pathlib import Path
import sys
import wave

import numpy as np

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise ValueError("Expected generated video and original mono PCM16 WAV")
    video, original = map(Path, sys.argv[1:])
    with wave.open(str(original)) as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError("Expected original mono PCM16 16kHz")
        reference = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
    report = importlib.import_module("audit-speech-motion-probe").audio_alignment(video, reference)
    print(json.dumps(report))
