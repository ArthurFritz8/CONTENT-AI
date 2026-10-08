"""Block duplicated/uncertain credit spending before any worker call."""
from decimal import Decimal
import importlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

mini = importlib.import_module("render-complete-mini-story")


class CompleteMiniBudgetTest(unittest.TestCase):
    def test_live_snapshot_restricts_operator_ceiling_and_preserves_floor(self):
        self.assertEqual(mini.credit_for_one({"metered_cost": "24.03490871"}, Decimal("8")), Decimal("5.96509129"))
        self.assertEqual(mini.credit_for_one({"metered_cost": "0"}, Decimal("6")), Decimal("6"))
        for billing, ceiling in (({"metered_cost": "26"}, Decimal("8")), ({"metered_cost": "NaN"}, Decimal("8")),
            ({"metered_cost": "-1"}, Decimal("8")), ({"metered_cost": "0"}, None)):
            with self.assertRaises(ValueError): mini.credit_for_one(billing, ceiling)

    def test_markers_and_partial_download_never_read_credentials_or_submit(self):
        for name in ("generation.lock.json", "reservation.json", "failure.json", "05/native.mp4"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                (folder / "05").mkdir()
                (folder / name).write_text("preserved")
                with patch.object(mini, "OUT", folder), patch.object(mini, "request", return_value={}), \
                    patch.object(mini.conversation, "credentials") as credentials, patch.object(mini.probe.app, "run") as cloud:
                    with self.assertRaises(ValueError): mini.run(Decimal("8"))
                    credentials.assert_not_called(); cloud.assert_not_called()
                    self.assertEqual((folder / name).read_text(), "preserved")

    def test_completed_checkpoint_audits_without_new_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "05").mkdir()
            (folder / "05/qa.json").write_text("{}")
            with patch.object(mini, "OUT", folder), patch.object(mini, "request", return_value={}), \
                patch.object(mini, "audit") as audit, patch.object(mini.conversation, "credentials") as credentials:
                mini.run(None)
                audit.assert_called_once(); credentials.assert_not_called()


if __name__ == "__main__": unittest.main()
