"""Generic, bounded production inputs. No cloud access or model allocation."""
from fractions import Fraction
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import wave

FRAMES, NATIVE_FPS, OUTPUT_FPS = 64, 16, 60
SHA = re.compile(r"^[a-f0-9]{64}$")


def fingerprint(data, expected, maximum):
    if (not isinstance(data, bytes) or not 0 < len(data) <= maximum or
            not isinstance(expected, str) or not SHA.fullmatch(expected) or
            hashlib.sha256(data).hexdigest() != expected):
        raise ValueError("Input size or fingerprint mismatch")


def validate_profile(profile, expected_sha):
    """Fail closed on unsupported registry versions, not just matching JSON bytes."""
    fields = {"version", "orientation", "short_edge", "output_fps", "style", "references", "voices"}
    if not isinstance(profile, dict) or set(profile) != fields or profile.get("version") != "1.0.0":
        raise ValueError("Unsupported production identity")
    if profile["orientation"] != "portrait" or type(profile["short_edge"]) is not int or not 480 <= profile["short_edge"] <= 704 or type(profile["output_fps"]) is not int or profile["output_fps"] != 60:
        raise ValueError("Profile exceeds deployed geometry or FPS")
    def text(value, maximum):
        return isinstance(value, str) and 1 <= len(value) <= maximum
    if not text(profile["style"], 3000) or len(profile["style"].strip()) < 30:
        raise ValueError("Missing visual direction")
    refs, voices = profile["references"], profile["voices"]
    if not isinstance(refs, list) or not 2 <= len(refs) <= 32 or not isinstance(voices, list) or not 2 <= len(voices) <= 8:
        raise ValueError("Incomplete character identity")
    for ref in refs:
        if not isinstance(ref, dict) or set(ref) != {"character_id", "path", "sha256"} or not text(ref["character_id"], 24) or not text(ref["path"], 1024) or not text(ref["sha256"], 64) or not SHA.fullmatch(ref["sha256"]):
            raise ValueError("Invalid registered reference")
    for voice in voices:
        if not isinstance(voice, dict) or set(voice) != {"character_id", "engine", "voice_id", "version", "sample_sha256"} or any(not text(voice[k], n) for k, n in (("character_id", 24), ("engine", 80), ("voice_id", 100), ("version", 100), ("sample_sha256", 64))) or not SHA.fullmatch(voice["sample_sha256"]):
            raise ValueError("Invalid registered voice")
    if len({v["character_id"] for v in voices}) != len(voices) or {r["character_id"] for r in refs} != {v["character_id"] for v in voices}:
        raise ValueError("Every registered character needs one versioned voice")
    actual = hashlib.sha256(json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    if actual != expected_sha:
        raise ValueError("Production identity fingerprint mismatch")


def validate_inputs(png, wav, audio_sha, *, frames=FRAMES, reference_sha):
    if type(frames) is not int or frames not in {64, 80}:
        raise ValueError("Unsupported bounded frame count")
    fingerprint(png, reference_sha, 12 * 1024 * 1024)
    from PIL import Image
    with Image.open(io.BytesIO(png)) as image:
        if image.format != "PNG" or not 480 <= min(image.size) or max(image.size) > 4096:
            raise ValueError("Expected bounded high-resolution PNG reference")
        image.verify()
    fingerprint(wav, audio_sha, 1024 * 1024)
    with wave.open(io.BytesIO(wav)) as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth(), audio.getcomptype()) != (1, 16000, 2, "NONE"):
            raise ValueError("Expected mono 16 kHz PCM16 dialogue")
        duration = audio.getnframes() / audio.getframerate()
        if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
            raise ValueError("Truncated dialogue")
    if not 0 < duration <= (frames - 1) / NATIVE_FPS:
        raise ValueError("Dialogue exceeds genuine generated coverage")
    return duration


def validate_pose(data, expected_sha, frames=FRAMES):
    fingerprint(data, expected_sha, 2 * 1024 * 1024)
    with tempfile.TemporaryDirectory(prefix="pose-preflight-") as directory:
        path = Path(directory) / "pose.mp4"
        path.write_bytes(data)
        streams = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames",
            "-show_streams", "-of", "json", str(path)], timeout=30))["streams"]
        if len(streams) != 1:
            raise ValueError("Pose guide must contain video only")
        s = streams[0]
        if (s["codec_type"], s["codec_name"], s["width"], s["height"], s["avg_frame_rate"], int(s["nb_read_frames"])) != ("video", "h264", 704, 1280, "16/1", frames):
            raise ValueError("Pose guide must match native geometry and timing")
        if abs(float(s.get("start_time", 0))) > .001:
            raise ValueError("Pose must start at zero")
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True, timeout=30)


def validate_request(png, wav, audio_sha, *, frames_count=FRAMES, reference_sha,
                     prompt, seed, pose=None, pose_sha=None):
    seconds = validate_inputs(png, wav, audio_sha, frames=frames_count, reference_sha=reference_sha)
    if (pose is None) != (pose_sha is None):
        raise ValueError("Pose data and fingerprint must be supplied together")
    if pose is not None:
        validate_pose(pose, pose_sha, frames_count)
    if not isinstance(prompt, str) or not 40 <= len(prompt.strip()) <= 2400 or type(seed) is not int or not 0 <= seed <= 2147483647:
        raise ValueError("Invalid acting direction")
    return seconds


def interpolation_schedule(count, source_fps, target_fps):
    if count < 2 or not 1 <= source_fps < target_fps <= 120:
        raise ValueError("Invalid interpolation contract")
    for index in range(int(Fraction(count - 1, source_fps) * target_fps) + 1):
        position = Fraction(index * source_fps, target_fps)
        left = int(position)
        yield left, min(left + 1, count - 1), float(position - left)
