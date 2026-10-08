"""Shared image definition. Importing does not build or allocate cloud resources."""
from pathlib import Path
import modal
from story_video_weights import WAN_COMMIT, RIFE_COMMIT, FLASH_WHEEL, build_models, check_interpolator
ROOT = Path(__file__).resolve().parents[1]

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git", "libgl1", "libglib2.0-0")
    .uv_pip_install("torch==2.8.0", "torchvision==0.23.0", "torchaudio==2.8.0",
        "numpy==1.26.4", "transformers==4.51.3", "diffusers==0.33.1", "tokenizers==0.21.4",
        "accelerate==1.11.0", "huggingface_hub==0.36.0", "decord==0.6.0", "librosa==0.11.0",
        "soundfile==0.13.1", "scipy==1.15.3", "opencv-python-headless==4.11.0.86",
        "einops==0.8.1", "easydict==1.13", "tqdm==4.67.1", "ftfy==6.3.1",
        "imageio==2.37.0", "imageio-ffmpeg==0.6.0", "safetensors==0.5.3",
        "Pillow==11.3.0", "sentencepiece==0.2.1", "protobuf==5.29.5", "peft==0.15.2")
    .run_commands(
        "git clone https://github.com/Wan-Video/Wan2.2.git /opt/wan && git -C /opt/wan checkout " + WAN_COMMIT,
        "git clone https://github.com/hzwer/Practical-RIFE.git /opt/rife && git -C /opt/rife checkout " + RIFE_COMMIT)
    .add_local_file(ROOT / "scripts/story_video_weights.py", "/root/story_video_weights.py", copy=True)
    .run_function(build_models, timeout=1800, cpu=4, memory=16384)
    # S2V cross-attention calls flash_attention directly, unlike TI2V's SDPA fallback.
    .uv_pip_install(FLASH_WHEEL)
    .run_commands("python -c 'import torch, flash_attn; assert torch._C._GLIBCXX_USE_CXX11_ABI; print(flash_attn.__version__)'")
    .run_function(check_interpolator, timeout=60, cpu=2, memory=2048)
    # Changes to acting/validation must not invalidate the large immutable weight build.
    .add_local_file(ROOT / "scripts/story_video_contract.py", "/root/story_video_contract.py", copy=True)
    .add_local_file(ROOT / "scripts/story_video_engine.py", "/root/story_video_engine.py", copy=True)
    .env({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false",
        "PYTHONPATH": "/opt/wan:/opt/rife:/opt/experiment"})
)
