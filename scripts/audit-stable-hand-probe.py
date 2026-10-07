"""Pose-conditioned preview QA and all-frame hand contact sheets, not anatomy certification."""
import hashlib
import importlib
import json
import logging
from pathlib import Path
import subprocess
import argparse

import numpy as np
from PIL import Image, ImageDraw

comparison = importlib.import_module("compare-story-acting")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/stable-hands-motion-probe"


def audit(arm_gesture=False):
    comparison.OUT = OUT
    if arm_gesture: comparison.BASE=ROOT/"output/stable-hands-motion-probe"
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
    regions = [[70,760,200,240],[430,590,260,240]] if arm_gesture else [[70,790,200,190],[470,640,220,190]]
    width,height=sum(r[2] for r in regions),regions[0][3]
    left,right=regions
    filters=(f"[0:v]split[a][b];[a]crop={left[2]}:{height}:{left[0]}:{left[1]}[w];"
        f"[b]crop={right[2]}:{height}:{right[0]}:{right[1]}[p];[w][p]hstack[v]")
    raw = subprocess.check_output(["ffmpeg","-v","error","-i",str(OUT/"malu-native.mp4"),
        "-filter_complex",filters,"-map","[v]","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],timeout=30)
    hands = np.frombuffer(raw,dtype=np.uint8).reshape(-1,height,width,3)
    if len(hands)!=64: raise ValueError("Hand review missed native frames")
    review = OUT/"review"
    for start in range(0,64,16):
        sheet = Image.new("RGB",(width*4,(height+26)*4),"#151515")
        draw = ImageDraw.Draw(sheet)
        for index in range(start,start+16):
            x,y = ((index-start)%4)*width,((index-start)//4)*(height+26)
            sheet.paste(Image.fromarray(hands[index]),(x,y))
            draw.text((x+4,y+height+3),f"native {index:02d} {index/16:.4f}s | waist / open palm",fill="white")
        sheet.save(review/f"all-hands-{start:02d}-{start+15:02d}.jpg",quality=98)
    report = {"pose_sha256":pose_sha,"pose_conditioned":True,"timings":timings,
        "native_frames_with_hand_crops":64,"hand_crop_regions":regions,
        "scope":"Review crops anchored to reference; inspect full frames if hands leave regions.",
        "anatomy_validated":False,"lip_sync_validated":False,"human_review_required":True,
        "published":False,"production_enabled":False}
    (OUT/"hand-review-qa.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    logging.info("Pose hash, audio, frame timing and decode passed; all 64 native hand pairs ready for inspection")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm-gesture",action="store_true")
    args=parser.parse_args()
    if args.arm_gesture: OUT=ROOT/"output/arm-gesture-motion-probe"
    audit(args.arm_gesture)
