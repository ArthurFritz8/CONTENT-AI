"""Self-contained offline worker tests. Synthetic transport fixtures are not video auditions."""
import hashlib
import importlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave
from PIL import Image
from story_video_contract import validate_request
from story_video_engine import MODEL, MODEL_REVISION, WAN_COMMIT, RIFE_REVISION, RIFE_SHA, GENERATION_SETTINGS, NEGATIVE
from story_video_relay import relay
from story_video_transport import PROVIDER, execution_hash, receive_outputs, verify_media, validate_report

runner = importlib.import_module("run-story-video-worker")


def inputs():
    png = io.BytesIO()
    Image.new("RGB", (704, 1280), "navy").save(png, format="PNG")
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setparams((1, 2, 16000, 32000, "NONE", "not compressed"))
        wav.writeframes(b"\x00\x00" * 32000)
    png, wav = png.getvalue(), audio.getvalue()
    return dict(png=png, wav=wav, audio_sha=hashlib.sha256(wav).hexdigest(), reference_sha=hashlib.sha256(png).hexdigest(),
        frames_count=64, prompt="An adult fruit character speaks the supplied dialogue with a coherent questioning gesture.", seed=21001, pose=None, pose_sha=None)


def report_for(request):
    return {"audio_conditioned": True, "lip_sync_validated": False, "human_review_required": True,
        "native_fps": 16, "native_frames": 64, "output_fps": 60, "output_frames": 237, "width": 704, "height": 1280,
        "model": MODEL, "model_revision": MODEL_REVISION, "wan_commit": WAN_COMMIT,
        "rife_revision": RIFE_REVISION, "rife_weights_sha256": RIFE_SHA, "steps": 40,
        "generation_settings": dict(GENERATION_SETTINGS), "negative_prompt": NEGATIVE,
        "init_first_frame": True, "audio_offset_seconds": 0, "no_loop_no_speed_change": True,
        "reference_sha256": request["reference_sha"], "input_audio_sha256": request["audio_sha"],
        "input_audio_seconds": 2, "pose_sha256": None, "pose_conditioned": False,
        "acting_prompt": request["prompt"], "seed": request["seed"], "model_reused": False,
        "model_retained_for_batch": False, "raw_native_rgb_sha256": "b" * 64}


def bundle_for(request):
    job = "00000000-0000-4000-8000-000000000123"
    origin = "https://fixture.supabase.co"
    prefix = f"{origin}/storage/v1/object/upload/sign/studio-private/workspace/videos/episode/{job}/lease"
    return {"job_id": job, "execution_sha256": execution_hash(), "callback": origin + "/functions/v1/studio-video-worker",
        "capability": "a" * 64, "uploads": {name: prefix + (f"/{name}.mp4" if name != "receipt" else "/receipt.json") + "?token=fixture" for name in ("native", "fluid", "receipt")}, "request": request}


class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="story-worker-fixtures-")
        cls.request = inputs()
        cls.report = report_for(cls.request)
        directory = Path(cls.temp.name)
        voice = directory / "voice.wav"
        voice.write_bytes(cls.request["wav"])
        cls.outputs = {}
        for name, fps, count in (("native", 16, 64), ("fluid", 60, 237)):
            path = directory / f"{name}.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=navy:s=704x1280:r={fps}",
                "-i", str(voice), "-frames:v", str(count), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True, timeout=30)
            cls.outputs[name] = path.read_bytes()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def stream(self, request=None):
        yield {"kind": "report", "report": report_for(request or self.request)}
        for name, data in self.outputs.items():
            yield {"kind": "manifest", "name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for offset in range(0, len(data), 128 * 1024):
                yield {"kind": "chunk", "name": name, "offset": offset, "data": data[offset:offset + 128 * 1024]}

    def test_new_registered_reference_is_generic_but_legacy_allowlist_stays_closed(self):
        self.assertEqual(validate_request(**self.request), 2)
        from story_motion_contract import validate_inputs
        with self.assertRaises(ValueError):
            validate_inputs(self.request["png"], self.request["wav"], self.request["audio_sha"], reference_sha=self.request["reference_sha"])

    def test_actual_modal_definitions_import_without_build_or_gpu(self):
        worker = importlib.import_module("modal-story-worker")
        self.assertIsInstance(worker.animate, runner.modal.Function)
        self.assertIsInstance(worker.deliver, runner.modal.Function)
        with self.assertRaises(ValueError): list(worker.animate.local(frames_count=80))

    def test_matching_hash_does_not_make_invalid_png_or_truncated_pcm_valid(self):
        for key, sha, value in (("png", "reference_sha", b"fake png"), ("wav", "audio_sha", self.request["wav"][:-100])):
            candidate = {**self.request, key: value, sha: hashlib.sha256(value).hexdigest()}
            with self.assertRaises(Exception): validate_request(**candidate)

    def test_invalid_preflight_never_imports_gpu_libraries(self):
        import story_video_engine
        with self.assertRaises(ValueError):
            next(story_video_engine.generate_speech(**{**self.request, "audio_sha": "0" * 64}))

    def test_reports_cannot_claim_native_sixty_fps_or_unreviewed_sync(self):
        for key, value in (("native_fps", 60), ("output_frames", 240), ("lip_sync_validated", True),
                           ("human_review_required", False), ("steps", 20), ("reference_sha256", "c" * 64)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_report({**self.report, key: value}, self.request)

    def test_real_media_passes_transport_decode_and_timing_checks(self):
        report, manifests, outputs = receive_outputs(self.stream(), self.request)
        with tempfile.TemporaryDirectory() as directory:
            verify_media(outputs, report, directory)
        self.assertEqual(manifests["fluid"]["sha256"], hashlib.sha256(self.outputs["fluid"]).hexdigest())

    def test_incomplete_or_corrupt_stream_never_reaches_uploader(self):
        packets = list(self.stream())
        for bad in (packets[:-1], [packets[0], packets[0]], [{**p, "offset": 1} if p["kind"] == "chunk" else p for p in packets]):
            with self.assertRaises(ValueError): receive_outputs(bad, self.request)

    def test_relay_completes_with_scoped_capability_absent_from_gpu_inputs(self):
        calls = []
        def http(url, data, headers, method="POST"):
            calls.append((url, method))
            if method == "PUT":
                self.assertNotIn("x-video-worker-capability", headers)
                return {}
            body = json.loads(data)
            if body["action"] == "complete":
                self.assertFalse(body["report"]["lip_sync_validated"])
                self.assertEqual(body["report"]["execution_sha256"], execution_hash())
            return {"code": "started" if body["action"] == "begin" else "saved"}
        generate = Mock(return_value=self.stream())
        result = relay(bundle_for(self.request), "fc-fixture", generate, http)
        self.assertEqual(result["code"], "completed")
        self.assertEqual(len([c for c in calls if c[1] == "PUT"]), 3)
        self.assertEqual(set(generate.call_args.kwargs), set(self.request))

    def test_repeated_cpu_call_never_repeats_gpu(self):
        generate = Mock()
        for code in ("already_started", "paused", "series_incompatible", "insufficient_capacity"):
            self.assertEqual(relay(bundle_for(self.request), "fc-fixture", generate, Mock(return_value={"code": code}))["code"], "reconcile")
        generate.assert_not_called()

    def test_wrong_execution_or_destination_cannot_contact_callback(self):
        bundle = bundle_for(self.request)
        for bad in ({**bundle, "execution_sha256": "0" * 64}, {**bundle, "callback": "http://localhost/functions/v1/studio-video-worker"},
                    {**bundle, "uploads": {**bundle["uploads"], "fluid": bundle["uploads"]["fluid"].replace("fixture.supabase.co", "other.supabase.co")}}):
            http, generate = Mock(), Mock()
            with self.assertRaises(ValueError): relay(bad, "fc-fixture", generate, http)
            http.assert_not_called(); generate.assert_not_called()

    def test_transport_failure_keeps_uncertainty_without_second_inference(self):
        actions = []
        def http(url, data, headers, method="POST"):
            if method == "PUT": raise RuntimeError("network failure")
            actions.append(json.loads(data)["action"])
            return {"code": "started"}
        generate = Mock(return_value=self.stream())
        self.assertEqual(relay(bundle_for(self.request), "fc-fixture", generate, http)["code"], "reconcile")
        generate.assert_called_once()
        self.assertEqual(actions, ["begin", "failed"])

    def test_resume_polls_existing_external_call_never_submits(self):
        db, function = Mock(), Mock()
        job = {"id": bundle_for(self.request)["job_id"], "state": "accepted", "external_id": "fc-fixture", "provider_id": PROVIDER, "execution_sha256": execution_hash()}
        with patch.object(runner.modal.FunctionCall, "from_id", return_value=Mock(get=Mock(side_effect=TimeoutError))):
            self.assertEqual(runner.dispatch(db, job, function)["code"], "pending")
        db.rpc.assert_not_called(); function.spawn.assert_not_called()

    def test_unknown_spawn_retains_reservation(self):
        bundle = bundle_for(self.request)
        db = Mock(url="https://fixture.supabase.co")
        job = {"id": bundle["job_id"], "state": "queued", "provider_id": PROVIDER, "execution_sha256": execution_hash()}
        def rpc(name, **kwargs):
            if name == "claim_video_job": return {"code": "claimed", "token": "lease"}
            if name == "register_video_worker": return {"prefix": "unused"}
            return {"code": "saved"}
        db.rpc.side_effect = rpc
        db.upload_url.side_effect = [bundle["uploads"][name] for name in ("native", "fluid", "receipt")]
        function = Mock(spawn=Mock(side_effect=RuntimeError("ambiguous network failure")))
        with patch.object(runner, "request_for", return_value=self.request):
            self.assertEqual(runner.dispatch(db, job, function)["code"], "reconcile")
        function.spawn.assert_called_once()
        self.assertEqual(db.rpc.call_args.kwargs["p_outcome"], "unknown")

    def test_unfunded_claim_never_submits(self):
        db, function = Mock(), Mock()
        db.rpc.return_value = {"code": "insufficient_capacity"}
        job = {"id": bundle_for(self.request)["job_id"], "state": "queued", "provider_id": PROVIDER, "execution_sha256": execution_hash()}
        with patch.object(runner, "request_for", return_value=self.request):
            self.assertEqual(runner.dispatch(db, job, function)["code"], "insufficient_capacity")
        function.spawn.assert_not_called()

    def test_registered_identity_and_measured_audio_are_checked_before_claim(self):
        workspace="00000000-0000-4000-8000-000000000001"
        reference_path=workspace+"/reference.png"
        profile={"version":"1.0.0","orientation":"portrait","output_fps":60,"short_edge":704,
            "style":"Stylized adult fruit characters in a Brazilian street with consistent materials.",
            "references":[{"character_id":c,"path":reference_path,"sha256":self.request["reference_sha"]} for c in ("malu","laran")],
            "voices":[{"character_id":c,"engine":"edge","voice_id":c,"version":"7.2.8","sample_sha256":"f"*64} for c in ("malu","laran")]}
        profile_sha=hashlib.sha256(json.dumps(profile,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
        shot={"id":"dialogue","kind":"dialogue","quality":"approved_master","reference_path":reference_path,
            "reference_sha256":self.request["reference_sha"],"audio_path":workspace+"/voice.wav","audio_sha256":self.request["audio_sha"],
            "prompt":self.request["prompt"],"seed":self.request["seed"],"seconds":2,"min_short_edge":704,"min_output_fps":60,
            "continuity":{"series_id":bundle_for(self.request)["job_id"],"profile_sha256":profile_sha}}
        job={"provider_id":PROVIDER,"execution_sha256":execution_hash(),"workspace_id":workspace,"episode_id":bundle_for(self.request)["job_id"],"shot_id":"dialogue","input":shot}
        db=Mock()
        script={}
        db.table.side_effect=lambda table,**kwargs: [{"profile":profile,"profile_sha256":profile_sha}] if table=="studio_series_production" else [{"script_json":script}]
        db.download.side_effect=lambda path,*args:self.request["png"] if path==reference_path else self.request["wav"]
        self.assertEqual(runner.request_for(db,job),self.request)
        voice_sha=hashlib.sha256(json.dumps(profile["voices"][0],sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
        binding={**shot,"character_id":"malu","voice_sha256":voice_sha,"audio_seconds":2}
        scene={"id":"dialogue","animation":binding,"story_visual":{"speaker_id":"malu"}}
        script.update(fiction={"animation":{"profile_sha256":profile_sha}},scenes=[scene]+[{"id":f"other-{i}"} for i in range(4)])
        self.assertEqual(runner.request_for(db,job),self.request)
        for field,value in (("voice_sha256","0"*64),("audio_seconds",1.5),("character_id","laran")):
            original=binding[field]; binding[field]=value
            with self.assertRaises(ValueError): runner.request_for(db,job)
            binding[field]=original
        for changed in ({**shot,"reference_path":workspace+"/other.png"},{**shot,"seconds":1.9},
                        {**shot,"continuity":{**shot["continuity"],"profile_sha256":"0"*64}}):
            with self.assertRaises(ValueError): runner.request_for(db,{**job,"input":changed})
        db.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
