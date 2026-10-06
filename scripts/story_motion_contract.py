"""Bounded audio-driven experiment contracts; no cloud imports or credentials."""
from fractions import Fraction
import hashlib
import io
import wave

REFERENCE_SHA = "7787a6cf6fd20359c78a9c7ff32f19f5108e2b802703bcc9716e9519c5442d95"
APPROVED_REFERENCES = {REFERENCE_SHA, "ad075fef288a790e5a56cb6aa947b1bf29060c742a553cca427c0b92379b3574"}
FRAMES, NATIVE_FPS, OUTPUT_FPS = 64, 16, 60


def validate_inputs(png: bytes, wav: bytes, audio_sha: str, *, frames=FRAMES, reference_sha=REFERENCE_SHA) -> float:
    if frames not in {64, 80} or reference_sha not in APPROVED_REFERENCES:
        raise ValueError("Only bounded approved conversation inputs are allowed")
    if len(png) > 12 * 1024 * 1024 or hashlib.sha256(png).hexdigest() != reference_sha:
        raise ValueError("Approved close fingerprint mismatch")
    if not 44 < len(wav) <= 1024 * 1024 or hashlib.sha256(wav).hexdigest() != audio_sha:
        raise ValueError("Invalid owned dialogue fingerprint or size")
    with wave.open(io.BytesIO(wav)) as audio:
        if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth(), audio.getcomptype()) != (1, 16000, 2, "NONE"):
            raise ValueError("Expected mono 16 kHz PCM16 dialogue")
        duration = audio.getnframes() / audio.getframerate()
        if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
            raise ValueError("Truncated dialogue data")
    # No artificial frozen tail: every output timestamp must have two native neighbours.
    if not 0 < duration <= (frames - 1) / NATIVE_FPS:
        raise ValueError("Dialogue exceeds genuine generated frame coverage")
    return duration


def interpolation_schedule(count: int, source_fps: int, target_fps: int):
    """Exact rational timestamps: never interpolate beyond the last source frame."""
    if count < 2 or not 1 <= source_fps < target_fps <= 120:
        raise ValueError("Invalid interpolation contract")
    final = Fraction(count - 1, source_fps)
    output_count = int(final * target_fps) + 1
    for index in range(output_count):
        position = Fraction(index * source_fps, target_fps)
        left = int(position)
        alpha = position - left
        yield left, min(left + 1, count - 1), float(alpha)
