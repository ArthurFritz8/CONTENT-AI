"""Male guide geometry and pre-allocation safety checks, without cloud calls."""
from decimal import Decimal
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

acting=importlib.import_module("test-story-body-acting")


class BodyActingTest(unittest.TestCase):
    def test_body_moves_and_hands_keep_geometry_with_hidden_points_omitted(self):
        initial=acting.keypoints(0)
        peak=acting.keypoints(2.1)
        self.assertGreater(np.linalg.norm(np.array(peak[0][1])-initial[0][1]),30)
        self.assertEqual(peak[0][8][0]-initial[0][8][0],10)
        base=np.array(acting.PALM)
        for i in range(80):
            body,palm,grip=acting.keypoints(i/16)
            np.testing.assert_allclose(np.array(palm)-palm[0],base-base[0],atol=1e-10)
            self.assertEqual(body[4],palm[0])
            self.assertEqual(body[7],grip[0])
            self.assertTrue(all(p is None for p in grip[1:]))
            self.assertIsNone(body[3])
            self.assertIsNone(body[9])
            self.assertTrue(all(0<x<704 and 550<y<1280 for x,y in palm))
        self.assertEqual(acting.keypoints(79/16),initial)

    def test_insufficient_credit_or_changed_prompt_never_loads_credentials_or_app(self):
        source=acting.OUT
        plan=json.loads((source/"plan.json").read_text(encoding="utf-8"))
        for reason in ("low_credit","unknown_credit","changed_prompt","reserved","failed","partial"):
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as directory:
                out=Path(directory); folder=out/"06";folder.mkdir()
                manifest=json.loads(json.dumps(plan))
                if reason=="changed_prompt": manifest["shots"][0]["prompt"]="wrong prompt"
                (out/"plan.json").write_text(json.dumps(manifest),encoding="utf-8")
                for name in ("pose.mp4","pose-guide.json"):
                    (folder/name).write_bytes((source/"06"/name).read_bytes())
                marker={"reserved":"generation.lock.json","failed":"failure.json","partial":"native.mp4"}.get(reason)
                if marker: (folder/marker).write_text("partial evidence")
                credit=None if reason=="unknown_credit" else Decimal("1") if reason=="low_credit" else Decimal("11.70")
                with patch.object(acting,"OUT",out),patch.object(acting.conversation,"credentials") as credentials,patch.object(acting.probe.app,"run") as start:
                    with self.assertRaises(ValueError): acting.run(credit)
                    credentials.assert_not_called();start.assert_not_called()

    def test_contract_rejects_worker_without_pose_or_with_wrong_audio(self):
        plan=json.loads((acting.OUT/"plan.json").read_text(encoding="utf-8"))
        request=acting.request_for(plan)
        report={"acting_prompt":acting.PROMPT,"seed":2006,"steps":40,"native_frames":80,"native_fps":16,
            "output_frames":297,"output_fps":60,"width":704,"height":1280,
            "input_audio_sha256":request["audio_sha"],"reference_sha256":acting.MALE_SHA,"pose_sha256":request["pose_sha"],
            "pose_conditioned":True,"audio_conditioned":True,"generation_settings":acting.probe.GENERATION_SETTINGS,
            "negative_prompt":acting.probe.NEGATIVE,"model_revision":acting.probe.MODEL_REVISION,
            "wan_commit":acting.probe.WAN_COMMIT,"rife_weights_sha256":acting.probe.RIFE_SHA,"model_reused":False}
        acting.verify(report,request)
        for field,value in (("pose_conditioned",False),("input_audio_sha256","0"*64),("native_frames",64)):
            with self.assertRaises(ValueError): acting.verify({**report,field:value},request)


if __name__=="__main__": unittest.main()
