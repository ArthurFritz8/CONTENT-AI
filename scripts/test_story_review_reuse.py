"""Protect previous reviews and reject changed sources before local re-editing."""
import importlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

conversation = importlib.import_module("render-story-conversation")


class ReviewReuseTest(unittest.TestCase):
    def test_existing_review_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            evidence = out / "operator-review.json"
            evidence.write_text('{"keep":"original"}', encoding="utf-8")
            with patch.object(conversation, "OUT", out), patch.object(conversation, "credentials") as credentials:
                with self.assertRaisesRegex(ValueError, "preserve previous evidence"):
                    conversation.prepare_guided_review()
                self.assertEqual(evidence.read_text(encoding="utf-8"), '{"keep":"original"}')
                credentials.assert_not_called()

    def test_changed_original_master_rejected_before_creating_review(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "review"
            with patch.object(conversation, "OUT", out), patch.object(conversation, "digest", return_value="0" * 64), patch.object(conversation, "credentials") as credentials, patch.object(conversation.probe.app, "run") as start:
                with self.assertRaisesRegex(ValueError, "Unchanged reviewed conversation"):
                    conversation.prepare_guided_review()
                self.assertFalse(out.exists())
                credentials.assert_not_called()
                start.assert_not_called()


if __name__ == "__main__":
    unittest.main()
