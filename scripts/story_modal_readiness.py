"""Read-only deployment inspection. Presence never certifies runtime or artistic quality."""
from story_video_transport import APP_NAME, PROVIDER, execution_hash


def inspect_runtime(expected_workspace, *, workspace=None, lookup=None):
    import modal
    from modal.exception import NotFoundError
    ws = workspace or modal.Workspace.from_context()
    ws.hydrate()
    if ws.name != expected_workspace:
        raise ValueError("Credentials point to another workspace")
    lookup = lookup or modal.Function.from_name
    functions = {}
    for name in ("animate", "deliver"):
        try:
            lookup(APP_NAME, name).hydrate()
            functions[name] = "present_runtime_unverified"
        except NotFoundError:
            functions[name] = "not_deployed"
        except Exception:
            # Network exception text can contain credentials or signed URLs.
            functions[name] = "verification_unavailable"
    return {"provider_id": PROVIDER, "local_execution_sha256": execution_hash(),
        "functions": functions, "read_only": True, "runtime_verified": False,
        "inference_submitted": False, "source_policy_modified": False}
