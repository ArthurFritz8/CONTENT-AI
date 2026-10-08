"""Pinned weights and build preflight, independent of acting/worker input changes."""
import hashlib
import logging
from pathlib import Path
import subprocess
import sys
logger = logging.getLogger("story-video-weights")

MODEL = "Wan-AI/Wan2.2-S2V-14B"
MODEL_REVISION = "dab4e9c55bbe4c8c4d03db1c2c98c7f0ac9c454b"
WAN_COMMIT = "1ea34ff48f87168174e12956e200b1d908b1c5ff"
RIFE_COMMIT = "bbfd2ea90910789a860ea3e2b32a240cd577b75e"
RIFE_REVISION = "01fdc7e97404120c243c3ea7b427046e5dc7643e"
RIFE_SHA = "1fa9b9cda3d9b8c3e301359e2595960902f97bf926c08598b0e9957a3f3f760e"
FLASH_WHEEL = (
    "https://github.com/Dao-AILab/flash-attention/releases/download/v2.8.3/"
    "flash_attn-2.8.3%2Bcu12torch2.8cxx11abiTRUE-cp311-cp311-linux_x86_64.whl"
    "#sha256=3d41b2fc55753faa7f45d6568ea73a96b96afb48b82994ab9b49bcbcb6c87588"
)


def build_models():
    """CPU build only; pinned public weights and an explicit archive whitelist."""
    import zipfile
    from unittest.mock import patch
    from huggingface_hub import snapshot_download, hf_hub_download
    sys.path[:0] = ["/opt/wan", "/opt/rife"]
    # Upstream evaluates the default GPU index at import (T5/CLIP/VAEs).
    # CPU import preflight does not instantiate these classes; runtime is unpatched.
    with patch("torch.cuda.current_device", return_value=0):
        from wan.speech2video import WanS2V
    assert WanS2V
    snapshot_download(MODEL, revision=MODEL_REVISION, local_dir="/opt/s2v-model", max_workers=4,
        allow_patterns=["*.json", "diffusion_pytorch*.safetensors", "models_t5_umt5-xxl-enc-bf16.pth",
            "Wan2.1_VAE.pth", "google/umt5-xxl/*", "wav2vec2-large-xlsr-53-english/*.json",
            "wav2vec2-large-xlsr-53-english/model.safetensors", "README.md", "LICENSE*"])
    archive = Path(hf_hub_download("hzwer/RIFE", "RIFEv4.26_0921.zip", revision=RIFE_REVISION))
    if hashlib.sha256(archive.read_bytes()).hexdigest() != RIFE_SHA:
        raise ValueError("RIFE author release fingerprint mismatch")
    destination = Path("/opt/rife/train_log")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for name in ("flownet.pkl", "IFNet_HDv3.py", "refine.py", "RIFE_HDv3.py"):
            (destination / name).write_bytes(package.read("RIFEv4.26_0921/" + name))
    # Imports are verified before allocating a GPU; no FlashAttention build is required.
    sys.path[:0] = ["/opt/wan", "/opt/rife"]
    from train_log.IFNet_HDv3 import IFNet
    assert WanS2V and IFNet
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=s=64x64",
        "-frames:v", "1", "-c:v", "libx264", "-f", "null", "-"], check=True, timeout=30)


def load_interpolator(device="cpu"):
    import torch
    sys.path.insert(0, "/opt/rife")
    from train_log.IFNet_HDv3 import IFNet
    net = IFNet().eval()
    state = torch.load("/opt/rife/train_log/flownet.pkl", map_location="cpu", weights_only=True)
    state = {key.removeprefix("module."): value for key, value in state.items()}
    # Author checkpoint includes two training-only heads, commented out in IFNet.
    # All active inference parameters must still match exactly (not blanket strict=False).
    state = {key: value for key, value in state.items() if not key.startswith(("teacher.", "caltime."))}
    net.load_state_dict(state, strict=True)
    return net.to(device)


def check_interpolator():
    load_interpolator()
    logger.info("RIFE active weights match author inference architecture")
