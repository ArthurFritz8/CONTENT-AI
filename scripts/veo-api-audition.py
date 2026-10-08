"""One bounded Veo API audition. Preflight is read-only; run may incur an API charge.

Usage:
  python scripts/veo-api-audition.py --preflight
  python scripts/veo-api-audition.py --run --max-usd 0.80 --funding-confirmed
  python scripts/veo-api-audition.py --resume

The Flow subscription balance is not an API budget. Do not set --funding-confirmed
until the developer credit is verified or a separate charge has been authorized.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/veo-api-audition"
REFERENCE = ROOT / "output/flow-malu-audition/malu-referencia.png"
PROMPT = ROOT / "output/flow-malu-audition/prompt.txt"
REFERENCE_SHA256 = "d7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c"
BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "veo-3.1-fast-generate-preview"
ESTIMATED_USD = 0.80  # 8s x $0.10/s at 720p; verify current Google price before running.
CONFIG = {"aspectRatio": "9:16", "durationSeconds": "8", "resolution": "720p", "numberOfVideos": 1,
          "personGeneration": "allow_adult"}
STATE = OUT / "state.json"


def save_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def api_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        env = ROOT / ".env.cloud"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    key = line.partition("=")[2].strip().strip("\"'")
                    break
    if not re.fullmatch(r"[\x21-\x7e]{20,200}", key):
        raise RuntimeError("GEMINI_API_KEY ausente ou inválida")
    return key


def api_json(method: str, url: str, key: str, payload: object | None = None) -> dict:
    if not url.startswith(BASE + "/"):
        raise RuntimeError("Destino da API não permitido")
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"x-goog-api-key": key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=60) as response:
            body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise RuntimeError("Resposta da API grande demais")
            result = json.loads(body)
            if not isinstance(result, dict):
                raise RuntimeError("Resposta da API inválida")
            return result
    except error.HTTPError as exc:
        # Never print upstream error text: it may echo the prompt, reference or credential.
        raise RuntimeError(f"API retornou HTTP {exc.code}") from None


def reference_and_prompt() -> tuple[bytes, str, str]:
    image = REFERENCE.read_bytes()
    if len(image) > 8_000_000 or image[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError("Referência PNG inválida")
    if hashlib.sha256(image).hexdigest() != REFERENCE_SHA256:
        raise RuntimeError("A imagem de referência aprovada mudou")
    prompt = PROMPT.read_text(encoding="utf-8").strip()
    if len(prompt) < 80 or len(prompt) > 4000:
        raise RuntimeError("Prompt inválido")
    fingerprint = hashlib.sha256(image + prompt.encode() + MODEL.encode() + json.dumps(CONFIG, sort_keys=True).encode()).hexdigest()
    return image, prompt, fingerprint


def read_state(fingerprint: str) -> dict | None:
    if not STATE.exists():
        return None
    state = json.loads(STATE.read_text(encoding="utf-8"))
    if state.get("fingerprint") != fingerprint:
        raise RuntimeError("Já existe uma operação para outro prompt; não sobrescrever nem reenviar")
    return state


def operation_url(name: str) -> str:
    if not re.fullmatch(r"models/veo-3\.1-fast-generate-preview/operations/[A-Za-z0-9_-]+", name):
        raise RuntimeError("Nome da operação inválido")
    return f"{BASE}/{name}"


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_video(uri: str, key: str) -> Path:
    parts = parse.urlsplit(uri)
    if parts.scheme != "https" or parts.hostname != "generativelanguage.googleapis.com" or parts.username or parts.password:
        raise RuntimeError("URL de vídeo fora da API oficial")
    opener = request.build_opener(NoRedirect)
    headers = {"x-goog-api-key": key}
    for _ in range(3):
        try:
            with opener.open(request.Request(uri, headers=headers), timeout=120) as response:
                if response.status != 200:
                    raise RuntimeError(f"Download retornou HTTP {response.status}")
                target = OUT / "clip.mp4"
                with target.open("wb") as output:
                    size = 0
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > 200 * 1024 * 1024:
                            raise RuntimeError("Vídeo excede 200 MB")
                        output.write(chunk)
                with target.open("rb") as verify:
                    verify.seek(4)
                    mp4_marker = verify.read(4)
                if size < 12 or mp4_marker != b"ftyp":
                    raise RuntimeError("Download não é MP4")
                return target
        except error.HTTPError as exc:
            if exc.code not in (301, 302, 303, 307, 308):
                raise RuntimeError(f"Download retornou HTTP {exc.code}") from None
            location = exc.headers.get("Location", "")
            next_uri = parse.urljoin(uri, location)
            next_parts = parse.urlsplit(next_uri)
            if next_parts.scheme != "https" or next_parts.hostname not in {
                "generativelanguage.googleapis.com", "storage.googleapis.com"
            } or next_parts.username or next_parts.password:
                raise RuntimeError("Redirecionamento de download não permitido")
            uri = next_uri
            if next_parts.hostname != "generativelanguage.googleapis.com":
                headers = {}  # Never send the API key to a storage redirect.
    raise RuntimeError("Download excedeu redirecionamentos permitidos")


def audit(video: Path) -> dict:
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)],
                           capture_output=True, text=True, timeout=30, check=True)
    info = json.loads(probe.stdout)
    stream = next((s for s in info["streams"] if s.get("codec_type") == "video"), None)
    audio = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)
    if not stream or not audio or int(stream["height"]) <= int(stream["width"]):
        raise RuntimeError("Vídeo vertical com áudio não encontrado")
    duration = float(info["format"]["duration"])
    if duration < 7.5 or duration > 9:
        raise RuntimeError("Duração inesperada")
    subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(video), "-f", "null", "-"],
                   capture_output=True, timeout=90, check=True)
    return {"duration_seconds": duration, "width": stream["width"], "height": stream["height"],
            "fps": stream.get("avg_frame_rate"), "audio_codec": audio.get("codec_name"),
            "sha256": hashlib.sha256(video.read_bytes()).hexdigest(), "human_review_pending": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--preflight", action="store_true")
    modes.add_argument("--run", action="store_true")
    modes.add_argument("--resume", action="store_true")
    parser.add_argument("--max-usd", type=float)
    parser.add_argument("--funding-confirmed", action="store_true")
    args = parser.parse_args()
    image, prompt, fingerprint = reference_and_prompt()
    key = api_key()
    if args.preflight:
        model = api_json("GET", f"{BASE}/models/{MODEL}", key)
        print(json.dumps({"model": model.get("name"), "reference_sha256": REFERENCE_SHA256,
                          "duration_seconds": 8, "aspect_ratio": "9:16", "resolution": "720p",
                          "max_estimated_usd": ESTIMATED_USD, "billing_or_credit_verified": False,
                          "generation_submitted": False}, ensure_ascii=False))
        return
    if args.run:
        if not args.funding_confirmed or args.max_usd is None or args.max_usd < ESTIMATED_USD or args.max_usd > ESTIMATED_USD:
            raise RuntimeError("Geração bloqueada: confirmar fonte de pagamento e limite exato de US$ 0,80")
        if read_state(fingerprint):
            raise RuntimeError("Já existe tentativa; use --resume em vez de reenviar")
        OUT.mkdir(parents=True, exist_ok=True)
        save_json(STATE, {"status": "submitting_unknown", "fingerprint": fingerprint,
                          "model": MODEL, "estimated_usd": ESTIMATED_USD})
        payload = {"instances": [{"prompt": prompt, "referenceImages": [{"image": {
            "inlineData": {"mimeType": "image/png", "data": base64.b64encode(image).decode("ascii")}},
            "referenceType": "asset"}]}], "parameters": CONFIG}
        # The only potentially billable call. Never retry on a network error.
        try:
            operation = api_json("POST", f"{BASE}/models/{MODEL}:predictLongRunning", key, payload)
        except RuntimeError as exc:
            if str(exc).startswith("API retornou HTTP"):
                save_json(STATE, {"status": "rejected_before_acceptance", "fingerprint": fingerprint,
                                  "error": str(exc)})
            raise
        name = operation.get("name", "")
        operation_url(name)
        save_json(STATE, {"status": "accepted", "fingerprint": fingerprint, "operation": name,
                          "estimated_usd": ESTIMATED_USD})
    state = read_state(fingerprint)
    if not state or state["status"] not in ("accepted", "completed", "review"):
        raise RuntimeError("Nenhuma operação aceita para retomar; envio anterior pode ser incerto")
    if state["status"] == "review":
        video = OUT / "clip.mp4"
        if not video.exists() or hashlib.sha256(video.read_bytes()).hexdigest() != state.get("sha256"):
            raise RuntimeError("Clipe revisado ausente ou alterado")
        print(json.dumps({"status": "review", "path": str(OUT / "clip.mp4")}))
        return
    if state["status"] == "accepted":
        url = operation_url(state["operation"])
        for _ in range(90):
            result = api_json("GET", url, key)
            if result.get("done") is True:
                if result.get("error"):
                    save_json(STATE, {**state, "status": "generation_failed"})
                    raise RuntimeError("Operação encerrada com erro; não reenviar automaticamente")
                uri = result.get("response", {}).get("generateVideoResponse", {}).get("generatedSamples", [{}])[0].get("video", {}).get("uri")
                if not isinstance(uri, str):
                    raise RuntimeError("Operação concluída sem URL do vídeo")
                state = {**state, "status": "completed", "video_uri": uri}
                save_json(STATE, state)
                break
            time.sleep(10)
        else:
            raise RuntimeError("Operação ainda em andamento; use --resume mais tarde")
    video = OUT / "clip.mp4"
    if not video.exists():
        video = download_video(state["video_uri"], key)
    report = audit(video)
    save_json(OUT / "qa.json", report)
    save_json(STATE, {**state, "status": "review", "video_uri": "[downloaded]", "sha256": report["sha256"]})
    print(json.dumps({"status": "review", "path": str(video), "technical_qa": report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
