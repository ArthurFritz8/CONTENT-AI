"""Trusted GitHub runner: preflight, claim and asynchronous Modal submission.
Never configures wallets/approvals or consumes a trial/fictitious balance.
"""
import argparse
import hashlib
import json
import os
import re
import secrets
import sys
import tempfile
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, build_opener
import modal
from story_video_contract import validate_request, validate_profile
from story_video_relay import NoRedirect, validate_bundle
from story_video_transport import APP_NAME, PROVIDER, execution_hash, validate_report, verify_media


class Studio:
    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        origin = urlsplit(self.url)
        if origin.scheme != "https" or not origin.hostname or not origin.hostname.endswith(".supabase.co") or origin.path or origin.query or origin.fragment or origin.username or origin.password or origin.port or not self.key:
            raise ValueError("Missing trusted Studio configuration")

    def request(self, path, method="GET", body=None, maximum=300000):
        request = Request(self.url + path, method=method, data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.key, "apikey": self.key, "Content-Type": "application/json"})
        with build_opener(NoRedirect).open(request, timeout=45) as response:
            data = response.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("Studio response exceeds bound")
        return data

    def table(self, table, **filters):
        return json.loads(self.request("/rest/v1/" + table + "?" + urlencode(filters)))

    def rpc(self, name, **args):
        return json.loads(self.request("/rest/v1/rpc/" + name, "POST", args))

    def download(self, path, workspace, maximum):
        if not isinstance(path, str) or not path.startswith(workspace + "/") or any(x in path for x in ("..", "\\", "?", "#")):
            raise ValueError("Input must be in this workspace's private storage")
        return self.request("/storage/v1/object/authenticated/studio-private/" + quote(path, safe="/"), maximum=maximum)

    def upload_url(self, path):
        data = json.loads(self.request("/storage/v1/object/upload/sign/studio-private/" + quote(path, safe="/"), "POST", {"upsert": False}))
        # Storage REST returns a path relative to /storage/v1, not to the origin.
        url = data.get("url")
        if not isinstance(url, str) or not url.startswith("/object/upload/sign/studio-private/"):
            raise ValueError("Unexpected signed upload response")
        return self.url + "/storage/v1" + url


def one(rows):
    if not isinstance(rows, list) or len(rows) != 1:
        raise ValueError("Expected one authorized production record")
    return rows[0]


def request_for(db, job):
    shot = job["input"]
    if job["provider_id"] != PROVIDER or job["execution_sha256"] != execution_hash() or shot.get("kind") != "dialogue" or shot.get("quality") != "approved_master" or shot.get("id") != job["shot_id"]:
        raise ValueError("Unqualified execution or shot")
    continuity = shot["continuity"]
    production = one(db.table("studio_series_production", select="profile,profile_sha256", series_id="eq." + continuity["series_id"], workspace_id="eq." + job["workspace_id"]))
    profile = production["profile"]
    if production["profile_sha256"] != continuity["profile_sha256"]:
        raise ValueError("Production identity fingerprint mismatch")
    validate_profile(profile, production["profile_sha256"])
    if not any(r.get("path") == shot.get("reference_path") and r.get("sha256") == shot.get("reference_sha256") for r in profile.get("references", [])):
        raise ValueError("Unregistered character reference")
    if not 1 <= shot.get("seconds", 0) <= 63 / 16 or not 480 <= shot.get("min_short_edge", 0) <= 704 or not 16 <= shot.get("min_output_fps", 0) <= 60:
        raise ValueError("Shot exceeds genuine generated coverage")
    request = {"png": db.download(shot["reference_path"], job["workspace_id"], 12 * 1024 * 1024),
        "wav": db.download(shot["audio_path"], job["workspace_id"], 1024 * 1024),
        "audio_sha": shot["audio_sha256"], "reference_sha": shot["reference_sha256"],
        "frames_count": 64, "prompt": shot["prompt"], "seed": shot["seed"], "pose": None, "pose_sha": None}
    # Hashes, PNG decoding, PCM duration and direction are verified before claiming or allocating.
    duration = validate_request(**request)
    if duration > shot["seconds"]:
        raise ValueError("Measured dialogue exceeds reserved shot duration")
    episode = one(db.table("episodes", select="script_json", id="eq." + job["episode_id"], workspace_id="eq." + job["workspace_id"]))
    script = episode.get("script_json")
    if not isinstance(script, dict):
        raise ValueError("Missing prepared episode script")
    if script.get("fiction", {}).get("animation"):
        scenes = script.get("scenes", [])
        scene = one([s for s in scenes if s.get("id") == shot["id"]])
        binding = scene.get("animation", {})
        character = binding.get("character_id")
        voice = one([v for v in profile["voices"] if v["character_id"] == character])
        voice_sha = hashlib.sha256(json.dumps(voice, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        if not 5 <= len(scenes) <= 8 or binding.get("voice_sha256") != voice_sha or scene.get("story_visual", {}).get("speaker_id") != character or any(
            binding.get(field) != shot.get(field) for field in ("reference_path", "reference_sha256", "audio_path", "audio_sha256", "prompt", "seed")) or not any(
            r["character_id"] == character and r["path"] == shot["reference_path"] and r["sha256"] == shot["reference_sha256"] for r in profile["references"]):
            raise ValueError("Reserved shot differs from the prepared character and voice")
        measured = binding.get("audio_seconds")
        if type(measured) not in (int, float) or abs(measured - duration) > 1 / 16000:
            raise ValueError("Prepared audio duration differs from actual PCM")
    return request


def recover(db, job, receipt=None):
    ticket = one(db.table("studio_video_worker_tickets", select="*", job_id="eq." + job["id"]))
    if receipt is None:
        receipt = json.loads(db.download(ticket["output_prefix"] + "/receipt.json", job["workspace_id"], 30000))
    if receipt.get("job_id") != job["id"] or receipt.get("report", {}).get("execution_sha256") != job["execution_sha256"]:
        raise ValueError("Recovery receipt belongs to another execution")
    request = {"reference_sha": job["input"]["reference_sha256"], "audio_sha": job["input"]["audio_sha256"],
        "prompt": job["input"]["prompt"], "seed": job["input"]["seed"]}
    validate_report(receipt["report"], request)
    outputs = {}
    for name in ("native", "fluid"):
        manifest = receipt["manifests"][name]
        if manifest.get("name") != name or type(manifest.get("size")) is not int or not 0 < manifest["size"] <= 30 * 1024 * 1024:
            raise ValueError("Invalid recovery manifest")
        data = db.download(ticket["output_prefix"] + f"/{name}.mp4", job["workspace_id"], manifest["size"])
        if len(data) != manifest["size"] or hashlib.sha256(data).hexdigest() != manifest["sha256"]:
            raise ValueError("Recovery output differs from its manifest")
        outputs[name] = data
    with tempfile.TemporaryDirectory(prefix="story-recovery-qa-") as directory:
        verify_media(outputs, receipt["report"], directory)
    return db.rpc("complete_video_worker", p_job=job["id"], p_capability=ticket["capability_sha256"],
        p_report=receipt["report"], p_manifests=receipt["manifests"], p_recovery=True)


def dispatch(db, job, function=None):
    if job["provider_id"] != PROVIDER or job["execution_sha256"] != execution_hash():
        raise ValueError("This worker cannot resume another provider or execution")
    if job["state"] == "completed":
        return {"code": "completed"}
    if job["state"] != "queued":
        # A restart polls the same external call or storage; it never submits another GPU.
        if job.get("external_id"):
            try:
                result = modal.FunctionCall.from_id(job["external_id"]).get(timeout=0)
            except TimeoutError:
                return {"code": "pending"}
            except Exception:
                result = None
            if isinstance(result, dict) and result.get("code") == "completed":
                return recover(db, job, result)
        try: return recover(db, job)
        except Exception: return {"code": "reconcile"}
    request = request_for(db, job)
    # Resolve deployed function before the claim: missing deployments consume no reservation lease.
    function = function or modal.Function.from_name(APP_NAME, "deliver")
    function.hydrate()
    claim = db.rpc("claim_video_job", p_job=job["id"])
    if claim.get("code") != "claimed":
        return {"code": claim.get("code", "invalid_claim")}
    lease = claim["token"]
    capability = secrets.token_hex(32)
    capability_hash = hashlib.sha256(capability.encode()).hexdigest()
    try:
        ticket = db.rpc("register_video_worker", p_job=job["id"], p_lease=lease, p_capability=capability_hash)
        uploads = {name: db.upload_url(ticket["prefix"] + (f"/{name}.mp4" if name != "receipt" else "/receipt.json")) for name in ("native", "fluid", "receipt")}
        bundle = {"job_id": job["id"], "execution_sha256": job["execution_sha256"], "callback": db.url + "/functions/v1/studio-video-worker",
            "capability": capability, "uploads": uploads, "request": request}
        validate_bundle(bundle)
    except Exception:
        # This branch precedes spawn, so non-acceptance is known.
        db.rpc("record_video_submission", p_job=job["id"], p_token=lease, p_outcome="rejected")
        return {"code": "rejected_before_acceptance"}
    try:
        call = function.spawn(bundle)
    except Exception:
        # spawn response failure is not proof of rejection; retain the full reservation.
        db.rpc("record_video_submission", p_job=job["id"], p_token=lease, p_outcome="unknown")
        return {"code": "reconcile"}
    db.rpc("record_video_submission", p_job=job["id"], p_token=lease, p_outcome="accepted", p_external=call.object_id)
    return {"code": "accepted"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execution", action="store_true", help="Show execution hash without cloud access")
    parser.add_argument("--job")
    args = parser.parse_args()
    if args.execution:
        print(json.dumps({"provider_id": PROVIDER, "execution_sha256": execution_hash(), "gpu_seconds_per_call_limit": 2100, "native_fps": 16, "output_fps": 60, "max_dialogue_seconds": 63 / 16}))
        return
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("CONTENT_AI_VIDEO_DISPATCH_ENABLED") != "true":
        raise ValueError("Production dispatch is not enabled on an authorized runner")
    if not args.job or not re.fullmatch(r"[a-f0-9-]{36}", args.job):
        raise ValueError("A durable job ID is required")
    db = Studio()
    job = one(db.table("studio_video_jobs", select="*", id="eq." + args.job))
    if job["state"] == "queued":
        # Expired billing never gets revived from a cached amount; this only reads the provider.
        from story_modal_budget import refresh
        refresh(db, job["wallet_id"])
    print(json.dumps({"job_id": job["id"], **dispatch(db, job)}))


if __name__ == "__main__":
    try: main()
    except Exception:
        # Never print network exceptions: signed URLs and capabilities may occur in them.
        print("Video worker stopped; reservation/job must be inspected in Studio.", file=sys.stderr)
        sys.exit(1)
