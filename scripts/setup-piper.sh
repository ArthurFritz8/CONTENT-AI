#!/usr/bin/env bash
set -euo pipefail
# Model card: pt_BR/faber/medium, dataset CC0. Engine: piper1-gpl GPL-3.0.
# Model bytes are pinned even if the upstream branch changes.
mkdir -p models
base='https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium'
curl --fail --location --retry 2 "$base/pt_BR-faber-medium.onnx" -o models/pt_BR-faber-medium.onnx
echo '858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7  models/pt_BR-faber-medium.onnx' | sha256sum --check
curl --fail --location --retry 2 "$base/pt_BR-faber-medium.onnx.json" -o models/pt_BR-faber-medium.onnx.json
echo '7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f  models/pt_BR-faber-medium.onnx.json' | sha256sum --check
