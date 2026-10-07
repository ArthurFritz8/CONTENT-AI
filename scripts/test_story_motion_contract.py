"""Offline failures and timing checks before allocating GPU compute."""
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
import tempfile
import wave
from unittest.mock import patch
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

    def test_second_character_and_extended_coverage_are_explicit(self):
        png = (ROOT / "output/humanized-story-pilot/references/laranjito-close-v1.png").read_bytes()
        wav = pcm(4.74)
        reference_sha = hashlib.sha256(png).hexdigest()
        self.assertAlmostEqual(validate_inputs(png, wav, hashlib.sha256(wav).hexdigest(),
            frames=80, reference_sha=reference_sha), 4.74)
        with self.assertRaises(ValueError):
            validate_inputs(png, wav, hashlib.sha256(wav).hexdigest())
        with self.assertRaises(ValueError):
            validate_inputs(png, wav, hashlib.sha256(wav).hexdigest(), frames=800, reference_sha=reference_sha)
        too_long = pcm(5)
        with self.assertRaises(ValueError):
            validate_inputs(png, too_long, hashlib.sha256(too_long).hexdigest(), frames=80, reference_sha=reference_sha)

    def test_five_second_take_has_no_frozen_tail(self):
        schedule = list(interpolation_schedule(80, 16, 60))
        self.assertEqual(len(schedule), 297)
        self.assertLessEqual(schedule[-1][0] + schedule[-1][2], 79)

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


class ProbeReservationTest(unittest.TestCase):
    def test_larger_arm_guide_preserves_finger_geometry_and_stays_in_frame(self):
        import importlib
        import numpy as np
        guide=importlib.import_module("prepare-stable-hand-guide")
        maximum=0
        for i in range(64):
            before,palm_before,waist_before=guide.points(i/16)
            after,palm_after,waist_after=guide.points(i/16,True)
            self.assertEqual(waist_before,waist_after)
            for joint in range(18):
                if joint not in (6,7): self.assertEqual(before[joint],after[joint])
            np.testing.assert_allclose(np.array(palm_after)-palm_after[0],np.array(palm_before)-palm_before[0],atol=1e-10)
            self.assertEqual(after[7],palm_after[0])
            for x,y in palm_after: self.assertTrue(0<x<704 and 0<y<1280)
            self.assertGreater(min(y for x,y in palm_after),600) # keep below the face
            maximum=max(maximum,float(np.linalg.norm(np.array(palm_after[0])-palm_before[0])))
        self.assertGreater(maximum,50)
        for t in (0,63/16): self.assertEqual(guide.points(t),guide.points(t,True))

    def test_gesture_only_comparison_rejects_prompt_drift_or_unchanged_pose(self):
        import importlib
        compare=importlib.import_module("compare-story-acting")
        baseline=json.loads((ROOT/"output/stable-hands-motion-probe/qa.json").read_text(encoding="utf-8"))
        old_inputs=json.loads((ROOT/"output/stable-hands-motion-probe/input.json").read_text(encoding="utf-8"))
        inputs=json.loads((ROOT/"output/arm-gesture-motion-probe/input.json").read_text(encoding="utf-8"))
        new={**baseline,"pose_sha256":inputs["pose_sha256"]}
        self.assertEqual(compare.validate_direction(baseline,old_inputs,new,inputs),["pose_trajectory"])
        for bad,manifest in (({**new,"acting_prompt":"changed"},{**inputs,"prompt":"changed"}),
                             ({**new,"pose_sha256":baseline["pose_sha256"]},inputs),
                             ({**new,"pose_conditioned":False},inputs)):
            with self.assertRaises(ValueError): compare.validate_direction(baseline,old_inputs,bad,manifest)

    def test_owned_pose_rejects_wrong_fingerprint_and_incomplete_video(self):
        import importlib
        probe = importlib.import_module("modal-speech-motion-probe")
        source = ROOT / "output/stable-hands-motion-probe/pose.mp4"
        data = source.read_bytes()
        probe.validate_pose(data, hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError):
            probe.validate_pose(data, "0" * 64)
        with tempfile.TemporaryDirectory(prefix="pose-coverage-") as directory:
            short = Path(directory) / "short.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", "1",
                "-c", "copy", str(short)], check=True, timeout=30)
            short_data = short.read_bytes()
            with self.assertRaises(ValueError):
                probe.validate_pose(short_data, hashlib.sha256(short_data).hexdigest())

    def test_pose_retiming_rejected_before_cloud_allocation(self):
        import importlib
        probe = importlib.import_module("modal-speech-motion-probe")
        source = ROOT / "output/stable-hands-motion-probe/pose.mp4"
        with tempfile.TemporaryDirectory(prefix="pose-rate-") as directory:
            path = Path(directory) / "retimed.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-itsscale", "0.5", "-i", str(source),
                "-c", "copy", str(path)], check=True, timeout=30)
            data = path.read_bytes()
            with self.assertRaises(ValueError):
                probe.validate_pose(data, hashlib.sha256(data).hexdigest())

    def test_pose_guide_preserves_each_hand_geometry_and_waist_anchor(self):
        import numpy as np
        guide = json.loads((ROOT / "output/stable-hands-motion-probe/pose-guide.json").read_text(encoding="utf-8"))
        base = np.array(guide["palm"])
        for body,palm,waist in guide["per_frame_keypoints"]:
            self.assertEqual(len(palm),21)
            self.assertEqual(len(waist),21)
            self.assertEqual(waist,guide["waist_hand"])
            np.testing.assert_allclose(np.array(palm)-palm[0],base-base[0],atol=1e-10)
            self.assertEqual(body[7],palm[0])
            self.assertEqual(body[4],waist[0])

    def test_rejected_inputs_and_reservations_do_not_start_cloud_app(self):
        import importlib
        probe = importlib.import_module("modal-speech-motion-probe")
        baseline = json.loads((ROOT / "output/audio-driven-motion-probe/input.json").read_text(encoding="utf-8"))
        wav = (ROOT / "output/audio-driven-motion-probe/voice.wav").read_bytes()
        for reason in ("prompt", "seed", "completed", "failure", "reserved"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory(prefix="probe-reservation-") as directory:
                out = Path(directory)
                inputs = {**baseline, "prompt": probe.EXPRESSIVE_PROMPT}
                if reason == "prompt":
                    inputs["prompt"] = probe.PROMPT
                if reason == "seed":
                    inputs["seed"] = probe.SEED + 1
                (out / "input.json").write_text(json.dumps(inputs), encoding="utf-8")
                (out / "voice.wav").write_bytes(wav)
                flag = {"completed": "qa.json", "failure": "failure.json", "reserved": "generation.lock.json"}.get(reason)
                if flag:
                    (out / flag).write_text("{}", encoding="utf-8")
                with patch.object(probe, "OUT", out), patch.object(probe.app, "run") as start:
                    with self.assertRaises(ValueError):
                        probe.run(expressive=True)
                    start.assert_not_called()


class AudioTransportTest(unittest.TestCase):
    def test_video_only_delay_rejected_even_when_voice_is_at_zero(self):
        import numpy as np
        spec = importlib.util.spec_from_file_location("speech_audit", ROOT / "scripts/audit-speech-motion-probe.py")
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        source = ROOT / "output/humanized-story-pilot/clips/07.mp4"
        info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_streams", "-of", "json", str(source)]))["streams"][0]
        num, den = map(int, info["avg_frame_rate"].split("/"))
        with wave.open(str(ROOT / "output/audio-driven-motion-probe/voice.wav")) as wav:
            reference = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float64)
        with tempfile.TemporaryDirectory(prefix="video-origin-audit-") as directory:
            path = Path(directory) / "video-shifted.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-itsoffset", "0.064", "-i", str(source),
                "-i", str(ROOT / "output/audio-driven-motion-probe/voice.wav"), "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-avoid_negative_ts", "disabled", str(path)], check=True)
            self.assertEqual(audit.audio_alignment(path, reference)["measured_audio_lag_seconds"], 0)
            with self.assertRaisesRegex(ValueError, "zero time origin"):
                audit.audit("shifted", num / den, int(info["nb_read_frames"]), reference, path=path)

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
