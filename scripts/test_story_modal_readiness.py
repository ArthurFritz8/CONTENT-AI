import unittest
from unittest.mock import Mock
from modal.exception import NotFoundError
from story_modal_readiness import inspect_runtime


class ModalReadinessTests(unittest.TestCase):
    def test_wrong_workspace_stops_before_function_lookup(self):
        ws = Mock(name="workspace"); ws.name = "other"
        lookup = Mock()
        with self.assertRaises(ValueError):
            inspect_runtime("expected", workspace=ws, lookup=lookup)
        lookup.assert_not_called()

    def test_function_presence_never_invokes_or_qualifies_source(self):
        ws = Mock(); ws.name = "expected"
        function = Mock(); lookup = Mock(return_value=function)
        report = inspect_runtime("expected", workspace=ws, lookup=lookup)
        self.assertEqual(report["functions"], {name: "present_runtime_unverified" for name in ("animate", "deliver")})
        self.assertFalse(report["runtime_verified"])
        self.assertFalse(report["source_policy_modified"])
        self.assertEqual(function.method_calls, [("hydrate", (), {}), ("hydrate", (), {})])

    def test_not_found_and_unknown_failure_are_distinct_and_sanitized(self):
        ws = Mock(); ws.name = "expected"
        function = Mock(); function.hydrate.side_effect = [NotFoundError("private endpoint"), RuntimeError("SECRET signed URL")]
        report = inspect_runtime("expected", workspace=ws, lookup=Mock(return_value=function))
        self.assertEqual(report["functions"]["animate"], "not_deployed")
        self.assertEqual(report["functions"]["deliver"], "verification_unavailable")
        self.assertNotIn("SECRET", str(report))


if __name__ == "__main__": unittest.main()
