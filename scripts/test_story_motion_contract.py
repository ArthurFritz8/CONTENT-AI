"""Offline failures and timing checks before allocating GPU compute."""
import hashlib
import io
import importlib.util
from pathlib import Path
import unittest
import subprocess
import tempfile
import wave
from story_motion_contract import validate_inputs, interpolation_schedule

ROOT = Path(__file__).resolve().parents[1]


def pcm(seconds=3.737, rate=16000):
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x01\x00" * int(seconds * rate))
    return data.getvalue()


class MotionContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.png = (ROOT / "output/humanized-story-pilot/references/malu-close-v1.png").read_bytes()

    def test_actual_owned_voice_fits(self):
        wav = (ROOT / "output/audio-driven-motion-probe/voice.wav").read_bytes()
        self.assertAlmostEqual(validate_inputs(self.png, wav, hashlib.sha256(wav).hexdigest()), 3.737, places=4)

    def test_changed_reference_rejected(self):
        wav = pcm()
        with self.assertRaises(ValueError):
            validate_inputs(self.png + b"changed", wav, hashlib.sha256(wav).hexdigest())

    def test_voice_changed_or_truncated_rejected(self):
        wav = pcm()
        for data, digest in [(wav + b"changed", hashlib.sha256(wav).hexdigest()),
                             (wav[:-100], hashlib.sha256(wav[:-100]).hexdigest())]:
            with self.assertRaises(ValueError):
                validate_inputs(self.png, data, digest)

    def test_long_or_wrong_sample_rate_rejected(self):
        for wav in (pcm(4.1), pcm(rate=24000)):
            with self.assertRaises(ValueError):
                validate_inputs(self.png, wav, hashlib.sha256(wav).hexdigest())

    def test_real_intermediates_without_frozen_tail(self):
        schedule = list(interpolation_schedule(64, 16, 60))
        self.assertEqual(len(schedule), 237)
        self.assertEqual(sum(alpha != 0 for _, _, alpha in schedule), 221)
        positions = [left + alpha for left, right, alpha in schedule]
        self.assertEqual(positions[0], 0)
        self.assertTrue(all(a < b for a, b in zip(positions, positions[1:])))
        self.assertLessEqual(positions[-1], 63)
        self.assertTrue(all(left < right for left, right, alpha in schedule if alpha))

    def test_no_scene_or_time_contract_guessing(self):
        for args in [(1, 16, 60), (64, 60, 30), (64, 0, 60), (64, 16, 240)]:
            with self.assertRaises(ValueError):
                list(interpolation_schedule(*args))


class AudioTransportTest(unittest.TestCase):
    def test_real_aac_mux_accepts_zero_and_rejects_200ms_offset(self):
        import numpy as np
        spec = importlib.util.spec_from_file_location("speech_audit", ROOT / "scripts/audit-speech-motion-probe.py")
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        with wave.open(str(ROOT / "output/audio-driven-motion-probe/voice.wav")) as audio:
            reference = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float64)
        with tempfile.TemporaryDirectory(prefix="speech-audit-") as directory:
            for offset in (0, .2):
                target = Path(directory) / f"offset-{offset}.mp4"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "output/humanized-story-pilot/clips/07.mp4"),
                    "-itsoffset", str(offset), "-i", str(ROOT / "output/audio-driven-motion-probe/voice.wav"),
                    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", str(target)], check=True, timeout=30)
                if offset:
                    with self.assertRaises(ValueError):
                        audit.audio_alignment(target, reference)
                else:
                    report = audit.audio_alignment(target, reference)
                    self.assertEqual(report["measured_audio_lag_seconds"], 0)
                    self.assertGreater(report["pcm_correlation"], .98)


if __name__ == "__main__":
    unittest.main()
