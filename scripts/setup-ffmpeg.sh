#!/usr/bin/env bash
set -euo pipefail
# ADR-015: the current ubuntu-latest image does not ship FFmpeg/ffprobe.
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends ffmpeg
fi
ffmpeg -version >/dev/null
ffprobe -version >/dev/null
