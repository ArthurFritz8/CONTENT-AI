"""Pose-conditioned preview QA and all-frame hand contact sheets, not anatomy certification."""
import hashlib
import importlib
import json
import logging
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw

comparison = importlib.import_module("compare-story-acting")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/stable-hands-motion-probe"


def audit():
    comparison.OUT = OUT
    comparison.compare()
    qa = json.loads((OUT/"qa.json").read_text(encoding="utf-8"))
    pose_sha = hashlib.sha256((OUT/"pose.mp4").read_bytes()).hexdigest()
    if not qa["pose_conditioned"] or qa["pose_sha256"] != pose_sha:
        raise ValueError("Conditioning guide not confirmed in worker output")
    timings = {}
    for name,fps,count in (("native",16,64),("fluid",60,237)):
        path = OUT/f"malu-{name}.mp4"
        frames = json.loads(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0",
            "-show_frames","-show_entries","frame=best_effort_timestamp_time","-of","json",str(path)],timeout=30))["frames"]
        if len(frames) != count: raise ValueError("Frame count changed")
        error = max(abs(float(f["best_effort_timestamp_time"])-i/fps) for i,f in enumerate(frames))
        if error>1e-5: raise ValueError("Frame timestamps have gaps or drift")
        timings[name] = {"frames":count,"fps":fps,"max_grid_error_seconds":error}
    # Diagnostic crops only. Final video is not cropped, masked or patched.
    filters = "[0:v]split[a][b];[a]crop=200:190:70:790[w];[b]crop=220:190:470:640[p];[w][p]hstack[v]"
    raw = subprocess.check_output(["ffmpeg","-v","error","-i",str(OUT/"malu-native.mp4"),
        "-filter_complex",filters,"-map","[v]","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],timeout=30)
    hands = np.frombuffer(raw,dtype=np.uint8).reshape(-1,190,420,3)
    if len(hands)!=64: raise ValueError("Hand review missed native frames")
    review = OUT/"review"
    for start in range(0,64,16):
        sheet = Image.new("RGB",(420*4,216*4),"#151515")
        draw = ImageDraw.Draw(sheet)
        for index in range(start,start+16):
            x,y = ((index-start)%4)*420,((index-start)//4)*216
            sheet.paste(Image.fromarray(hands[index]),(x,y))
            draw.text((x+4,y+193),f"native {index:02d} {index/16:.4f}s | waist / open palm",fill="white")
        sheet.save(review/f"all-hands-{start:02d}-{start+15:02d}.jpg",quality=98)
    report = {"pose_sha256":pose_sha,"pose_conditioned":True,"timings":timings,
        "native_frames_with_hand_crops":64,"hand_crop_regions":[[70,790,200,190],[470,640,220,190]],
        "scope":"Review crops anchored to reference; inspect full frames if hands leave regions.",
        "anatomy_validated":False,"lip_sync_validated":False,"human_review_required":True,
        "published":False,"production_enabled":False}
    (OUT/"hand-review-qa.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    logging.info("Pose hash, audio, frame timing and decode passed; all 64 native hand pairs ready for inspection")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    audit()
