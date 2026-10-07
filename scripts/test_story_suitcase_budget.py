"""Current-credit gates and bounded new-story input rejection, without cloud calls."""
from decimal import Decimal
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import suitcase_story_contract as contract
story = importlib.import_module("prepare-suitcase-story")


class SuitcaseBudgetTest(unittest.TestCase):
    def test_floor_selects_zero_one_two_without_spending_to_zero(self):
        two = contract.reserve(2) + contract.KEEP_CREDIT
        one = contract.reserve(1) + contract.KEEP_CREDIT
        self.assertEqual(two, Decimal("7.73972800"))
        self.assertEqual(one, Decimal("5.11986400"))
        for value,expected in ((Decimal("0"),0),(one-Decimal(".01"),0),(one,1),
            (two-Decimal(".01"),1),(two,2),(Decimal("8"),2)):
            count = contract.affordable_takes(value)
            self.assertEqual(count,expected)
            if count: self.assertGreaterEqual(value-contract.reserve(count), contract.KEEP_CREDIT)
        for value in (None, Decimal("NaN"),Decimal("Infinity"),Decimal("-1"),Decimal("31")):
            with self.assertRaises(ValueError): contract.affordable_takes(value)

    def test_unknown_credit_failure_and_partial_never_access_credentials(self):
        source = story.OUT
        plan = story.preflight()
        for reason in ("unknown","failed","reserved","partial"):
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as directory:
                out = Path(directory)
                (out/"plan.json").write_text(json.dumps(plan),encoding="utf-8")
                for shot in plan["shots"]: (out/shot["id"]).mkdir()
                marker = {"failed":"failure.json","reserved":"generation.lock.json","partial":"02/native.mp4"}.get(reason)
                if marker: (out/marker).write_text("preserved evidence")
                # preflight reads absolute root-referenced assets, so only local state differs.
                with patch.object(story,"OUT",out), patch.object(story.conversation,"credentials") as credentials,patch.object(story.probe.app,"run") as cloud:
                    with self.assertRaises(ValueError): story.run(None if reason=="unknown" else Decimal("8"))
                    credentials.assert_not_called(); cloud.assert_not_called()
                    if marker: self.assertEqual((out/marker).read_text(),"preserved evidence")
                    self.assertFalse((out/"cloud-selection.json").exists())
                self.assertTrue(source.exists())

    def test_unaffordable_run_records_zero_calls_without_credentials(self):
        plan = story.preflight()
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out/"plan.json").write_text(json.dumps(plan),encoding="utf-8")
            for shot in plan["shots"]: (out/shot["id"]).mkdir()
            with patch.object(story,"OUT",out),patch.object(story.conversation,"credentials") as credentials,patch.object(story.probe.app,"run") as cloud:
                story.run(Decimal("4"), "modal_billing_cli_conservative")
                self.assertEqual(story.read(out/"cloud-selection.json")["selected"],[])
                self.assertEqual(story.read(out/"cloud-selection.json")["balance_source"], "modal_billing_cli_conservative")
                self.assertFalse((out/"generation.lock.json").exists())
                credentials.assert_not_called(); cloud.assert_not_called()

    def test_altered_direction_rejected_before_allocation(self):
        plan = story.preflight()
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            plan["shots"][1]["prompt"] = "different scene or quality"
            (out/"plan.json").write_text(json.dumps(plan),encoding="utf-8")
            with patch.object(story,"OUT",out),patch.object(story.conversation,"credentials") as credentials,patch.object(story.probe.app,"run") as cloud:
                with self.assertRaises(ValueError): story.run(Decimal("8"))
                credentials.assert_not_called(); cloud.assert_not_called()
                self.assertFalse((out/"cloud-selection.json").exists())

    def test_changed_offscreen_cover_rejected_before_cloud(self):
        plan = story.preflight()
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            plan["shots"][4]["fallback_reference"]["sha256"] = "0" * 64
            (out/"plan.json").write_text(json.dumps(plan),encoding="utf-8")
            with patch.object(story,"OUT",out),patch.object(story.conversation,"credentials") as credentials,patch.object(story.probe.app,"run") as cloud:
                with self.assertRaises(ValueError): story.run(Decimal("8"))
                credentials.assert_not_called(); cloud.assert_not_called()
                self.assertFalse((out/"cloud-selection.json").exists())


if __name__ == "__main__": unittest.main()
