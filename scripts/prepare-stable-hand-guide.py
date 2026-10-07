"""Own technical pose map: reference-aligned hands, small upper-body motion."""
import colorsys
import hashlib
import json
import logging
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps
import importlib
import argparse

probe = importlib.import_module("modal-speech-motion-probe")
OUT = probe.ROOT / "output/stable-hands-motion-probe"
# Manually annotated on the owned reference fitted to 704x1248 plus 16px top matte.
# OpenPose order: nose/neck/right arm/left arm/right leg/left leg/eyes/ears.
BODY = [(369,488),(274,569),(61,607),(12,787),(104,884),(355,603),(422,813),(510,759),
    (180,979),None,None,(288,984),None,None,(316,438),(425,449),(197,478),(448,477)]
PALM = [(510,759),(532,729),(567,699),(604,685),(637,676),
    (551,735),(588,740),(628,730),(660,721),
    (547,745),(589,757),(626,746),(654,734),
    (540,751),(577,765),(608,757),(637,744),
    (529,754),(557,765),(584,760),(612,750)]
WAIST = [(104,884),(115,863),(140,856),(170,865),(192,873),
    (135,874),(163,872),(193,884),(220,893),
    (136,882),(166,890),(197,908),(213,919),
    (135,892),(158,907),(181,921),(196,934),
    (133,901),(149,919),(162,931),(174,941)]
BONES = [(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),
    (1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
HAND_BONES = [(0,root) for root in (1,5,9,13,17)] + [
    (i,i+1) for root in (1,5,9,13,17) for i in range(root,root+3)]
COLORS = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),
    (0,255,0),(0,255,85),(0,255,170),(0,255,255),(0,170,255),(0,85,255),
    (0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]


def pulse(t, start, end):
    return math.sin(math.pi*(t-start)/(end-start))**2 if start < t < end else 0


def points(t, arm_gesture=False):
    question, emphasis = pulse(t,.1,2.1), pulse(t,2.25,3.6)
    dx, dy = 7*question, -5*question-6*emphasis
    body = [None if p is None else (p[0]+dx,p[1]+dy) for p in BODY]
    # Waist and hips remain fixed. Visible palm translates <12px; fingers never curl/rotate.
    for i in (4,8,11): body[i] = BODY[i]
    for i in (0,14,15,16,17): body[i] = (body[i][0],body[i][1]+6*emphasis)
    palm = [(x+6*question,y-8*emphasis) for x,y in PALM]
    if arm_gesture:
        # One larger elbow-led palm-up beat; translation only, no finger/wrist rotation.
        palm = [(x-38*emphasis,y-42*emphasis) for x,y in palm]
        body[6] = (body[6][0]-16*emphasis,body[6][1]-20*emphasis)
    body[7] = palm[0]
    return body, palm, WAIST


def draw_keypoints(body, hands):
    """Same diagnostic palette for character-specific coordinates, including occlusions."""
    canvas = Image.new("RGB",(704,1280),"black")
    draw = ImageDraw.Draw(canvas)
    for i,(a,b) in enumerate(BONES):
        if body[a] is not None and body[b] is not None:
            draw.line([body[a],body[b]],fill=tuple(int(c*.6) for c in COLORS[i]),width=7)
    for i,p in enumerate(body):
        if p is not None: draw.ellipse((p[0]-4,p[1]-4,p[0]+4,p[1]+4),fill=COLORS[i])
    for hand in hands:
        for i,(a,b) in enumerate(HAND_BONES):
            color = tuple(round(c*255) for c in colorsys.hsv_to_rgb(i/20,1,1))
            if hand[a] is not None and hand[b] is not None:
                draw.line([hand[a],hand[b]],fill=color,width=3)
        for point in hand:
            if point is not None:
                x,y=point
                draw.ellipse((x-2,y-2,x+2,y+2),fill=(255,0,0))
    return canvas


def draw_map(t, arm_gesture=False):
    body, palm, waist = points(t,arm_gesture)
    return draw_keypoints(body, (palm,waist))


def prepare(arm_gesture=False):
    OUT.mkdir(parents=True,exist_ok=True)
    if any((OUT/name).exists() for name in ("pose.mp4","input.json","qa.json","generation.lock.json")):
        raise ValueError("Existing guide/experiment must be preserved, not overwritten")
    reference = probe.ROOT / "output/humanized-story-pilot/references/malu-close-v1.png"
    reference_sha = hashlib.sha256(reference.read_bytes()).hexdigest()
    if reference_sha != probe.REFERENCE_SHA: raise ValueError("Owned reference changed")
    first_frame = draw_map(0,arm_gesture)
    probe.encode((np.asarray(draw_map(i/16,arm_gesture)) for i in range(64)),OUT/"pose.mp4",704,1280,16)
    sha = hashlib.sha256((OUT/"pose.mp4").read_bytes()).hexdigest()
    probe.validate_pose((OUT/"pose.mp4").read_bytes(),sha)
    reference_fit = ImageOps.fit(Image.open(reference).convert("RGB"),(704,1248))
    overlay = Image.new("RGB",(704,1280),"black"); overlay.paste(reference_fit,(0,16))
    # Diagnostic annotation only; never used as character image or substituted in rendered video.
    guide = np.asarray(first_frame); photo = np.asarray(overlay).copy()
    mask = guide.max(axis=2)>0; photo[mask] = guide[mask]
    Image.fromarray(photo).save(OUT/"alignment-review.png")
    first_frame.save(OUT/"pose-first-frame.png")
    data = {"license":"own","source":"system","reference_sha256":reference_sha,
        "video_sha256":sha,"frames":64,"fps":16,"width":704,"height":1280,
        "annotation":"Manual technical keypoints on owned reference; not automated hand anatomy QA",
        "body":BODY,"palm":PALM,"waist_hand":WAIST,"hand_bones":HAND_BONES,
        "per_frame_keypoints":[points(i/16,arm_gesture) for i in range(64)],
        "trajectory":"elbow-led-palm-up-v2" if arm_gesture else "restrained-v1",
        "limitation":"Synthetic projected pose; model adherence and rendered fingers require visual validation."}
    (OUT/"pose-guide.json").write_text(json.dumps(data,indent=2),encoding="utf-8")
    if arm_gesture:
        peak = .5*(2.25+3.6)
        draw_map(peak,True).save(OUT/"pose-peak-frame.png")
        guide = np.asarray(draw_map(peak,True)); photo = np.asarray(overlay).copy()
        mask = guide.max(axis=2)>0; photo[mask] = guide[mask]
        Image.fromarray(photo).save(OUT/"alignment-peak-review.png")
    logging.info("Own pose guide decoded: 64 frames, 16 fps, two fixed-shape 21-point hands")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm-gesture",action="store_true")
    args=parser.parse_args()
    if args.arm_gesture: OUT=probe.ROOT/"output/arm-gesture-motion-probe"
    prepare(args.arm_gesture)
