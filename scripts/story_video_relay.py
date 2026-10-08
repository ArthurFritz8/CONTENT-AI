"""CPU-only relay. Its capability is scoped to one job and two output objects."""
import json
import re
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from story_video_contract import validate_request
from story_video_transport import execution_hash, receive_outputs, verify_media


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("Redirects are not allowed for private worker transport")


def validate_bundle(bundle):
    if not isinstance(bundle, dict) or set(bundle) != {"job_id", "execution_sha256", "callback", "capability", "uploads", "request"}:
        raise ValueError("Invalid worker bundle")
    if not re.fullmatch(r"[a-f0-9-]{36}", bundle["job_id"]) or not re.fullmatch(r"[a-f0-9]{64}", bundle["capability"]):
        raise ValueError("Invalid job capability")
    if bundle["execution_sha256"] != execution_hash():
        raise ValueError("Deployment differs from reserved execution")
    callback = urlsplit(bundle["callback"])
    if callback.scheme != "https" or not callback.hostname or not callback.hostname.endswith(".supabase.co") or callback.username or callback.password or callback.port or callback.query or callback.fragment or callback.path != "/functions/v1/studio-video-worker":
        raise ValueError("Untrusted callback destination")
    if set(bundle["uploads"]) != {"native", "fluid", "receipt"}:
        raise ValueError("Expected bounded output destinations")
    prefix = None
    for name, url in bundle["uploads"].items():
        target = urlsplit(url)
        ending = f"/{name}.mp4" if name != "receipt" else "/receipt.json"
        if target.scheme != "https" or target.netloc != callback.netloc or target.fragment or not target.path.startswith("/storage/v1/object/upload/sign/studio-private/") or not target.path.endswith(ending):
            raise ValueError("Untrusted upload destination")
        parent = target.path[:-len(ending)]
        if prefix is not None and parent != prefix:
            raise ValueError("Outputs must belong to the same job")
        prefix = parent
        if f"/{bundle['job_id']}/" not in parent:
            raise ValueError("Upload belongs to a different job")
    r = bundle["request"]
    if not isinstance(r, dict) or set(r) != {"png", "wav", "audio_sha", "reference_sha", "prompt", "seed", "frames_count", "pose", "pose_sha"} or r["frames_count"] != 64:
        raise ValueError("Only bounded 64-frame dialogue is deployed")
    return validate_request(**r)


def request_json(url, data, headers=None, method="POST"):
    request = Request(url, data=data, method=method, headers=headers or {})
    with build_opener(NoRedirect).open(request, timeout=45) as response:
        body = response.read(30001)
    if len(body) > 30000:
        raise ValueError("Oversized worker response")
    return json.loads(body)


def relay(bundle, external_id, generate, http=request_json):
    """begin is a one-shot gate, including when Modal repeats this CPU invocation."""
    validate_bundle(bundle)
    def callback(action, **values):
        return http(bundle["callback"], json.dumps({"action": action, "job_id": bundle["job_id"], **values}, separators=(",", ":")).encode(),
            {"Content-Type": "application/json", "x-video-worker-capability": bundle["capability"]})
    begin = callback("begin", external_id=external_id)
    if begin.get("code") != "started":
        return {"code": "reconcile", "reason": begin.get("code", "invalid_begin")}
    try:
        report, manifests, outputs = receive_outputs(generate(**bundle["request"]), bundle["request"])
        with tempfile.TemporaryDirectory(prefix="story-output-qa-") as directory:
            verify_media(outputs, report, directory)
        report = {**report, "execution_sha256": bundle["execution_sha256"]}
        receipt = {"job_id": bundle["job_id"], "report": report, "manifests": manifests}
        for name in ("native", "fluid", "receipt"):
            data = outputs[name] if name != "receipt" else json.dumps(receipt, separators=(",", ":"), ensure_ascii=False).encode()
            try:
                http(bundle["uploads"][name], data, {"Content-Type": "video/mp4" if name != "receipt" else "application/json", "x-upsert": "false"}, method="PUT")
            except HTTPError as error:
                # A prior PUT may have succeeded before its response was lost.
                # Completion independently verifies actual storage checksums.
                if error.code not in {400, 409}:
                    raise
        for attempt in range(3):
            try:
                result = callback("complete", report=report, manifests=manifests)
                if result.get("code") != "saved":
                    raise ValueError("Completion was not persisted")
                return {"code": "completed", **receipt}
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1)
    except Exception:
        # Failure/uncertainty never frees a reservation or retries inference.
        try: callback("failed", code="EXECUTION_OR_TRANSPORT_FAILED")
        except Exception: pass
        return {"code": "reconcile", "reason": "EXECUTION_OR_TRANSPORT_FAILED"}
