"""Local PCM/reference inspection only; never allocates a model or calls a provider."""
import json
import sys
from pathlib import Path
from story_video_contract import validate_request

def inspect(data):
    return {"audio_seconds": validate_request(png=Path(data["png_path"]).read_bytes(), wav=Path(data["wav_path"]).read_bytes(),
        reference_sha=data["reference_sha256"], audio_sha=data["audio_sha256"], prompt=data["prompt"], seed=data["seed"])}

if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw)>16384: raise ValueError("Oversized inspection request")
        print(json.dumps(inspect(json.loads(raw))))
    except Exception:
        print("Reference or measured dialogue violates the production contract.", file=sys.stderr)
        sys.exit(1)
