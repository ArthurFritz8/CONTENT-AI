"""Local review montage: copied video frames, native audio, no cloud or production writes."""
from pathlib import Path
import argparse
import array
import hashlib
import json
import math
import subprocess


def command(arguments, binary=False):
    result = subprocess.run(arguments, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f"{arguments[0]} failed: {result.stderr.decode('utf-8', errors='replace')[-500:]}")
    return result.stdout if binary else result.stdout.decode("utf-8")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def probe(path):
    return json.loads(command(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(path)]))


def frame_hashes(path):
    data = command(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0", "-f", "framemd5", "-"])
    return [line.rsplit(",", 1)[-1].strip() for line in data.splitlines() if line and not line.startswith("#")]


def pcm(path, video_start=0.0, seconds=None):
    filtering = "aresample=async=1:first_pts=0"
    if seconds is not None:
        filtering += f",apad,atrim=end={seconds:.12f}"
    return array.array("h", command(["ffmpeg", "-v", "error", "-copyts", "-itsoffset", f"{-video_start:.12f}",
                                     "-i", str(path), "-map", "0:a:0", "-af", filtering,
                                     "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], binary=True))


def alignment(reference, assembled, offset_seconds, seconds):
    # Compare original waveforms at the cut, not speech text, timbre or claimed lip sync.
    offset = round(offset_seconds * 16000)
    indices = list(range(160, min(len(reference), round(seconds * 16000)) - 160, 32))
    expected = [reference[i] for i in indices]
    energy = sum(x*x for x in expected)
    if not energy:
        return {"silent_reference": True, "measured_lag_seconds": 0, "correlation": None}
    best = (-1.0, 0)
    for lag in range(-320, 321):
        if offset + indices[0] + lag < 0 or offset + indices[-1] + lag >= len(assembled):
            continue
        actual = [assembled[offset+i+lag] for i in indices]
        norm = sum(x*x for x in actual)
        correlation = sum(a*b for a, b in zip(expected, actual)) / math.sqrt(energy*norm) if norm else 0
        if correlation > best[0]:
            best = (correlation, lag)
    if best[0] < .90 or abs(best[1]) >= 320:
        raise RuntimeError("Native audio shifted or changed during montage")
    return {"silent_reference": False, "measured_lag_seconds": best[1]/16000, "correlation": best[0]}


def assemble(sources, directory):
    if not 2 <= len(sources) <= 9:
        raise ValueError("Review montage requires two to nine identified clips")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    cuts, intermediates, expected_frames, audio = [], [], [], []
    shape = None
    cursor = 0.0
    for index, source in enumerate(sources):
        path = Path(source["path"]).resolve()
        if sha(path) != source["sha256"]:
            raise ValueError("Source identity changed")
        metadata = probe(path)
        videos = [s for s in metadata["streams"] if s["codec_type"] == "video"]
        audios = [s for s in metadata["streams"] if s["codec_type"] == "audio"]
        if len(videos) != 1 or len(audios) != 1:
            raise ValueError("Every speaker requires one native video and audio track")
        v, a = videos[0], audios[0]
        signature = (v["width"], v["height"], v["codec_name"], v["pix_fmt"], a["sample_rate"], a["channels"])
        if (shape is not None and shape != signature) or v["codec_name"] != "h264" or v["pix_fmt"] != "yuv420p" or v["avg_frame_rate"] != "24/1":
            raise ValueError("Source formats differ; refuse silent resizing or FPS conversion")
        shape = signature
        frames = int(v["nb_read_frames"])
        seconds = frames / 24
        if frames <= 0 or abs(float(v["duration"]) - seconds) > .002 or seconds > 15:
            raise ValueError("Source video duration is not its native 24 FPS frame grid")
        video_start = float(v.get("start_time", 0))
        if not math.isfinite(video_start) or not 0 <= video_start <= .15:
            raise ValueError("Unexpected native video origin")
        original_pcm = pcm(path, video_start)
        if len(original_pcm)/16000 < seconds - .03:
            raise ValueError("Source audio does not cover the complete shot")
        audio.append(pcm(path, video_start, seconds))
        expected_frames.extend(frame_hashes(path))
        target = directory / f"{index+1:02d}-native.mov"
        # MOV preserves the exact video timebase; PCM removes per-file AAC encoder padding.
        # Trim only AAC excess beyond the video, never speed up or replace the voice.
        command(["ffmpeg", "-y", "-v", "error", "-copyts", "-itsoffset", f"{-video_start:.12f}",
                 "-i", str(path), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-video_track_timescale", "12288",
                 "-af", f"aresample=async=1:first_pts=0,apad,atrim=end={seconds:.12f},asetpts=PTS-STARTPTS",
                 "-c:a", "pcm_s16le", "-avoid_negative_ts", "disabled", str(target)])
        intermediates.append((target, seconds))
        cuts.append({"speaker": source["speaker"], "source_sha256": source["sha256"], "start_seconds": cursor,
                     "seconds": seconds, "frames": frames, "original_audio": True,
                     "source_video_start_seconds": video_start, "native_audio_timestamps_normalized": True})
        cursor += seconds
    listing = directory / "concat.ffconcat"
    def escape(path):
        return str(path).replace("\\", "/").replace("'", "'\\''")
    listing.write_text("ffconcat version 1.0\n" + "".join(f"file '{escape(path)}'\nduration {seconds:.12f}\n" for path, seconds in intermediates), encoding="utf-8")
    output = directory / "sequence.mp4"
    command(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-video_track_timescale", "12288",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)])
    command(["ffmpeg", "-v", "error", "-xerror", "-i", str(output), "-f", "null", "-"])
    metadata = probe(output)
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    actual_frames = frame_hashes(output)
    if actual_frames != expected_frames or abs(float(video["duration"])-cursor) > .002 or video["avg_frame_rate"] != "24/1":
        raise RuntimeError("Montage changed frames, their order, FPS or timeline")
    final_pcm = pcm(output)
    for cut, original in zip(cuts, audio):
        cut["audio_transport"] = alignment(original, final_pcm, cut["start_seconds"], cut["seconds"])
    report = {"file": str(output), "sha256": sha(output), "seconds": cursor, "width": shape[0], "height": shape[1],
              "encoded_fps": 24, "frames": len(actual_frames), "cuts": cuts, "all_decoded_frames_pixel_identical": True,
              "video_reencoded": False, "audio_encoded_once_from_native_pcm": True, "decode_verified": True,
              "new_cloud_calls": 0, "production_ready": False, "voice_continuity_approved": False, "human_review_required": True}
    (directory/"assembly-qa.json").write_text(json.dumps(report, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources_json", type=Path)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    print(json.dumps(assemble(json.loads(args.sources_json.read_text(encoding="utf-8")), args.output_directory), ensure_ascii=False))
