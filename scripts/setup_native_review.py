"""Download pinned public CPU speech weights, without a token or GPU quota."""
from huggingface_hub import snapshot_download
from review_native_media import MODEL_REVISION

snapshot_download("Systran/faster-whisper-base", revision=MODEL_REVISION,
                  token=False,allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*"])
