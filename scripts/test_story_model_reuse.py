"""Offline budget, lifecycle and corrupt-transport checks; no credentials/GPU."""
import hashlib
import importlib
import json
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

probe = importlib.import_module("modal-speech-motion-probe")
benchmark = importlib.import_module("benchmark-story-model-reuse")


class ModelReuseTest(unittest.TestCase):
    def test_same_weights_reused_and_third_take_blocked(self):
        session = probe.ModelSession()
        pipeline = object()
        load = Mock(return_value=pipeline)
        first, reused = session.acquire(load)
        self.assertIs(first, pipeline)
        self.assertFalse(reused)
        second, reused = session.acquire(load)
        self.assertIs(second, first)
        self.assertTrue(reused)
        load.assert_called_once()
        with self.assertRaises(ValueError):
            session.acquire(load)
        session.close()
        self.assertIsNone(session.pipeline)
        with self.assertRaises(ValueError):
            session.acquire(load)

    def test_failed_constructor_is_terminal(self):
        session = probe.ModelSession()
        load = Mock(side_effect=RuntimeError("load failed"))
        with self.assertRaises(RuntimeError):
            session.acquire(load)
        with self.assertRaises(ValueError):
            session.acquire(load)
        load.assert_called_once()
        self.assertTrue(session.closed)

    def test_complete_batch_validated_before_generation(self):
        plan = benchmark.expected_plan()
        requests = benchmark.requests_for(plan)
        probe.validate_batch(requests)
        for bad in (requests[:1], requests * 2, [requests[0], {**requests[1], "seed": probe.SEED + 1}],
                    [requests[0], {**requests[1], "frames_count": 80}],
                    [requests[0], {**requests[1], "pose_sha": "0" * 64}],
                    [requests[0], {**requests[1], "unexpected": 1}]):
            with self.subTest(length=len(bad)), self.assertRaises(ValueError):
                probe.validate_batch(bad)

    def test_missing_balance_bad_plan_or_partial_work_never_starts_cloud(self):
        plan = benchmark.expected_plan()
        for reason in ("missing_balance", "small_balance", "nan", "infinite", "changed_plan", "lock", "failure", "partial"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                out = Path(directory)
                value = None if reason == "missing_balance" else "1" if reason == "small_balance" else "NaN" if reason == "nan" else "Infinity" if reason == "infinite" else "30"
                candidate = {**plan, "takes": 3} if reason == "changed_plan" else plan
                (out / "plan.json").write_text(json.dumps(candidate), encoding="utf-8")
                if reason in {"lock", "failure"}:
                    (out / ("generation.lock.json" if reason == "lock" else "failure.json")).write_text("{}")
                if reason == "partial":
                    (out / "0").mkdir()
                with patch.object(benchmark, "OUT", out), patch.object(probe.app, "run") as start, patch.object(benchmark.conversation, "credentials") as credentials:
                    with self.assertRaises(ValueError):
                        benchmark.run(value)
                    start.assert_not_called()
                    credentials.assert_not_called()

    def test_interleaved_or_missing_take_marker_rejected(self):
        with self.assertRaises(ValueError):
            list(benchmark.take_stream(iter([{"kind": "progress", "stage": "generation", "take": 1}]), 0))
        with self.assertRaises(ValueError):
            list(benchmark.take_stream(iter([]), 0))

    def test_worker_failure_releases_session_without_starting_second_take(self):
        requests = benchmark.requests_for(benchmark.expected_plan())
        session = probe.ModelSession()
        def failed_inference(**kwargs):
            kwargs["model_session"].acquire(lambda: object())
            raise RuntimeError("inference failed")
            yield  # generator failure occurs during iteration, not construction
        with patch.object(probe, "ModelSession", return_value=session), patch.object(probe, "generate_speech", side_effect=failed_inference) as generate, patch.dict(sys.modules, {"torch": Mock()}):
            with self.assertRaisesRegex(RuntimeError, "inference failed"):
                list(probe.speak_reuse_benchmark.local(requests))
        generate.assert_called_once()
        self.assertTrue(session.closed)
        self.assertIsNone(session.pipeline)

    def test_completed_checkpoint_never_starts_cloud(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / "plan.json").write_text(json.dumps(benchmark.expected_plan()), encoding="utf-8")
            (out / "comparison.json").write_text("{}")
            with patch.object(benchmark, "OUT", out), patch.object(benchmark, "audit") as audit, patch.object(probe.app, "run") as start, patch.object(benchmark.conversation, "credentials") as credentials:
                benchmark.run()
                audit.assert_called_once()
                start.assert_not_called()
                credentials.assert_not_called()

    def test_tampered_model_settings_block_checkpoint(self):
        plan = benchmark.expected_plan()
        report = {**plan["fixed"], "input_audio_sha256": plan["audio_sha256"],
            "pose_sha256": plan["pose_sha256"], "acting_prompt": plan["prompt"],
            "model_reused": True, "model_retained_for_batch": True,
            "audio_conditioned": True, "pose_conditioned": True, "output_frames": 237,
            "raw_native_rgb_sha256": "a" * 64, "width": 704, "height": 1280,
            "audio_offset_seconds": 0, "init_first_frame": True,
            "generation_settings": plan["generation_settings"], "negative_prompt": plan["negative_prompt"]}
        benchmark.verify_report(report, plan, 1)
        for key, changed in (("steps", 20), ("model_reused", False), ("pose_sha256", "0" * 64),
                             ("raw_native_rgb_sha256", "not-a-sha"),
                             ("generation_settings", {**plan["generation_settings"], "guide_scale": 1})):
            with self.subTest(key=key), self.assertRaises(ValueError):
                benchmark.verify_report({**report, key: changed}, plan, 1)


class SpeechTransportTest(unittest.TestCase):
    def test_real_existing_videos_survive_shared_transport_and_decode(self):
        baseline = probe.ROOT / "output/stable-hands-motion-probe"
        packets = [{"kind": "report", "report": {"human_review_required": True}}]
        expected = {}
        for name in ("native", "fluid"):
            data = (baseline / f"malu-{name}.mp4").read_bytes()
            expected[name] = hashlib.sha256(data).hexdigest()
            packets.append({"kind": "manifest", "name": name, "size": len(data), "sha256": expected[name]})
            for offset in range(0, len(data), 128 * 1024):
                packets.append({"kind": "chunk", "name": name, "offset": offset, "data": data[offset:offset + 128 * 1024]})
        with tempfile.TemporaryDirectory() as directory:
            result = probe.receive_stream(packets, Path(directory))
            for name in expected:
                self.assertEqual(hashlib.sha256((Path(directory) / f"malu-{name}.mp4").read_bytes()).hexdigest(), expected[name])
                self.assertEqual(result["outputs"][name]["sha256"], expected[name])
            self.assertTrue(result["human_review_required"])

    def test_corrupt_second_output_does_not_store_first(self):
        data = b"bounded test payload"
        packets = [{"kind": "report", "report": {}}]
        for name in ("native", "fluid"):
            packets += [{"kind": "manifest", "name": name, "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest() if name == "native" else "0" * 64},
                {"kind": "chunk", "name": name, "offset": 0, "data": data}]
        with tempfile.TemporaryDirectory() as directory, patch.object(probe.subprocess, "run") as decode:
            with self.assertRaisesRegex(ValueError, "checksum"):
                probe.receive_stream(packets, Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])
            decode.assert_not_called()

    def test_duplicate_report_bad_offset_empty_or_oversized_chunk_rejected(self):
        report = {"kind": "report", "report": {}}
        manifest = {"kind": "manifest", "name": "native", "size": 5, "sha256": "a" * 64}
        packets = ([report, report], [report, manifest, {"kind": "chunk", "name": "native", "offset": 1, "data": b"a"}],
            [report, manifest, {"kind": "chunk", "name": "native", "offset": 0, "data": b""}],
            [report, manifest, {"kind": "chunk", "name": "native", "offset": 0, "data": b"a" * 6}])
        with tempfile.TemporaryDirectory() as directory:
            for items in packets:
                with self.subTest(items=len(items)), self.assertRaises(ValueError):
                    probe.receive_stream(items, Path(directory))


if __name__ == "__main__":
    unittest.main()
