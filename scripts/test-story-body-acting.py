"""One new audio/pose-driven male take, then local conversation reuse. No publication."""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import importlib
import json
import logging
from pathlib import Path
import subprocess
import sys
import time
import wave

import modal
import numpy as np
from PIL import Image, ImageOps

probe = importlib.import_module("modal-speech-motion-probe")
guide = importlib.import_module("prepare-stable-hand-guide")
conversation = importlib.import_module("render-story-conversation")
auditor = importlib.import_module("audit-speech-motion-probe")
ROOT = probe.ROOT
OUT = ROOT / "output/body-acting-conversation"
BASE = ROOT / "output/guided-acting-conversation"
MALE_SHA = "ad075fef288a790e5a56cb6aa947b1bf29060c742a553cca427c0b92379b3574"
RATE, TIMEOUT = Decimal("0.00145548"), 2400  # H200 + the same 4 physical CPUs / 64 GiB
REQUIRED = RATE * TIMEOUT + Decimal("1")
logger = logging.getLogger("body-acting-test")
PROMPT = (
    "Cinematic realistic stylized 3D dialogue of the exact adult orange man in the reference. "
    "Preserve orange skin texture, short dark hair, moustache, cream linen shirt, denim jeans and biscuit. "
    "He looks left toward the silent blurred apple woman and speaks the provided Portuguese audio "
    "with accurate lips and jaw timing. Follow the supplied body and hand pose guide. "
    "Play a visibly guilty attempt to justify eating her biscuit: from his original stance, "
    "he recoils his upper torso slightly away from her, shifts weight through his hips, and raises "
    "his shoulders subtly during the first sentence. Hold the hesitant recoil through the pause, "
    "then release his shoulders and recover toward his original stance as he finishes the excuse. "
    "His chest, shirt, shoulders and arms respond together, not just his head or hand. "
    "His visible open palm retains the same fingers and orientation, following the arm naturally; "
    "the other hand keeps holding the same biscuit behind his back, fingers and grip preserved. "
    "One smooth preparation, recoil and recovery; no walking, wrist twisting, finger curling, "
    "hand exchange, reaching toward the face or changing props. Preserve the original camera axis "
    "and golden-hour Brazilian street. Stable camera, only the orange man speaks, coherent anatomy."
)
# Manually annotated on this male reference fitted to 704x1248, with 16px top matte.
# Invisible knee/ankle/ear and occluded cookie-grip fingers are omitted, not invented.
BODY = [(325,448),(420,552),(347,605),None,(321,761),(519,611),
    (543,875),(621,990),(367,1160),None,None,(566,1185),None,None,
    (274,408),(333,365),None,(507,441)]
PALM = [(321,761),(304,737),(318,727),(330,706),(338,686),
    (313,696),(309,669),(300,638),(288,609),
    (292,698),(282,667),(273,636),(260,607),
    (272,706),(262,682),(251,656),(239,625),
    (252,721),(244,705),(232,684),(219,660)]
GRIP = [(621,990)] + [None]*20


def digest(data):
    return hashlib.sha256(data).hexdigest()


def action(t):
    def ease(value):
        return .5 - .5*np.cos(np.pi*value)
    if t <= .35 or t >= 4.50:
        return 0.
    if t < 1.70:
        return float(ease((t-.35)/1.35))
    if t <= 2.55:
        return 1.
    return float(1-ease((t-2.55)/1.95))


def keypoints(t):
    strength = action(t)
    body = []
    for index, point in enumerate(BODY):
        if point is None:
            body.append(None)
            continue
        dx,dy = (10,0) if index in (8,11) else (10,-2) if index == 7 else (18,-8) if index == 6 else (32,-14)
        body.append((point[0]+dx*strength, point[1]+dy*strength))
    palm = [(x+30*strength,y-10*strength) for x,y in PALM]
    body[4] = palm[0]
    grip = [body[7]] + [None]*20
    return body,palm,grip


def pose_frame(t):
    body,palm,grip=keypoints(t)
    return guide.draw_keypoints(body,(palm,grip))


def prepare():
    if OUT.exists():
        raise ValueError("Existing experiment must be preserved")
    plan = json.loads((BASE/"plan.json").read_text(encoding="utf-8"))
    review = json.loads((BASE/"operator-review.json").read_text(encoding="utf-8"))
    assembly = json.loads((BASE/"assembly.json").read_text(encoding="utf-8"))
    if (not review.get("viewed_excerpt_quality_accepted") or review["video_sha256"] != assembly["sha256"] or
            digest((BASE/assembly["filename"]).read_bytes()) != assembly["sha256"] or
            plan["production_enabled"] or plan["published"] or plan["database_writes"]):
        raise ValueError("Unchanged excerpt-reviewed source required")
    shot = next(s for s in plan["shots"] if s["id"]=="06")
    png = (ROOT/shot["reference"]["path"]).read_bytes()
    wav = (ROOT/shot["audio"]).read_bytes()
    probe.validate_request(png,wav,shot["audio_sha256"],frames_count=80,reference_sha=MALE_SHA,
        prompt=PROMPT,seed=2006)
    if shot["reference"]["sha256"] != MALE_SHA or shot["frames"] != 80 or shot["seed"] != 2006:
        raise ValueError("Male identity/seed/coverage changed")
    OUT.mkdir()
    folder=OUT/"06"; folder.mkdir()
    probe.encode((np.asarray(pose_frame(i/16)) for i in range(80)),folder/"pose.mp4",704,1280,16)
    pose_sha=digest((folder/"pose.mp4").read_bytes())
    probe.validate_pose((folder/"pose.mp4").read_bytes(),pose_sha,80)
    reference_fit=ImageOps.fit(Image.open(ROOT/shot["reference"]["path"]).convert("RGB"),(704,1248))
    for name,t in (("initial",0),("peak",2.1)):
        overlay=Image.new("RGB",(704,1280),"black"); overlay.paste(reference_fit,(0,16))
        body,palm,grip=keypoints(t)
        frame=guide.draw_keypoints(body,(palm,grip))
        pixels=np.asarray(overlay).copy(); mask=np.asarray(frame).max(axis=2)>0
        pixels[mask]=np.asarray(frame)[mask]
        Image.fromarray(pixels).save(folder/f"alignment-{name}.png")
    conversation.save(folder/"pose-guide.json",{"license":"own","source":"system","reference_sha256":MALE_SHA,
        "pose_sha256":pose_sha,"frames":80,"fps":16,"body":BODY,"palm":PALM,"occluded_grip":GRIP,
        "per_frame_keypoints":[keypoints(i/16) for i in range(80)],
        "trajectory":"torso-recoil-weight-shift-v1","annotation":"manual male-reference keypoints; unseen fingers omitted",
        "limitation":"projected guide, body adherence/anatomy require playback review"})
    for other in plan["shots"]:
        if other["id"]=="06":
            other.update(prompt=PROMPT,pose_sha256=pose_sha,reused=False)
            continue
        source=BASE/other["id"]; target=OUT/other["id"]; target.mkdir()
        import shutil
        qa=json.loads((source/"qa.json").read_text(encoding="utf-8"))
        for name in ("native","fluid"):
            path=source/f"{name}.mp4"
            if digest(path.read_bytes()) != qa["outputs"][name]["sha256"]:
                raise ValueError("Reused clip changed")
            shutil.copyfile(path,target/path.name)
        conversation.save(target/"qa.json",{**qa,"reused":True,"new_worker_seconds":0})
        conversation.save(target/"av-audit.json",json.loads((source/"av-audit.json").read_text(encoding="utf-8")))
    plan.update(review_variant="male-body-acting-v1",new_gpu_calls=1,
        gpu_requested="H200",worker_timeout_seconds=TIMEOUT,
        generation_settings=dict(probe.GENERATION_SETTINGS),negative_prompt=probe.NEGATIVE,
        worker_timeout_upper_estimate_usd=str(RATE*TIMEOUT),required_available_credit_usd=str(REQUIRED),
        budget_scope="one new take; estimate not invoice; no auto retry; other three takes reused")
    conversation.save(OUT/"plan.json",plan)
    logger.info("Prepared one 80-frame body-acting take and three reused takes; inspect initial/peak guides")


def request_for(plan):
    shot=plan["shots"][0]
    if ([s["id"] for s in plan["shots"]]!=["06","07","08","09"] or shot["seed"]!=2006 or
            shot["prompt"]!=PROMPT or shot["frames"]!=80 or plan["new_gpu_calls"]!=1 or
            plan["generation_settings"]!=probe.GENERATION_SETTINGS or plan["negative_prompt"]!=probe.NEGATIVE or
            plan.get("gpu_requested")!="H200" or plan.get("worker_timeout_seconds")!=TIMEOUT or
            plan["review_variant"]!="male-body-acting-v1" or plan["published"] or
            plan["production_enabled"] or plan["database_writes"]):
        raise ValueError("Unbounded or altered body-acting plan")
    request={"png":(ROOT/shot["reference"]["path"]).read_bytes(),"wav":(ROOT/shot["audio"]).read_bytes(),
        "audio_sha":shot["audio_sha256"],"frames_count":80,"reference_sha":MALE_SHA,"prompt":PROMPT,
        "seed":2006,"pose":(OUT/"06/pose.mp4").read_bytes(),"pose_sha":shot["pose_sha256"]}
    probe.validate_request(**request)
    baseline=json.loads((ROOT/"output/audio-driven-conversation/06/qa.json").read_text(encoding="utf-8"))
    if request["audio_sha"]!=baseline["input_audio_sha256"] or shot["reference"]["sha256"]!=MALE_SHA:
        raise ValueError("Conditioning differs from original male dialogue")
    geometry=json.loads((OUT/"06/pose-guide.json").read_text(encoding="utf-8"))
    if geometry["license"]!="own" or geometry["pose_sha256"]!=request["pose_sha"] or geometry["reference_sha256"]!=MALE_SHA:
        raise ValueError("Guide provenance changed")
    return request


def verify(report,request):
    expected={"acting_prompt":PROMPT,"seed":2006,"steps":40,"native_frames":80,"native_fps":16,
        "output_frames":297,"output_fps":60,"width":704,"height":1280,
        "input_audio_sha256":request["audio_sha"],"reference_sha256":MALE_SHA,"pose_sha256":request["pose_sha"],
        "pose_conditioned":True,"audio_conditioned":True,"generation_settings":probe.GENERATION_SETTINGS,
        "negative_prompt":probe.NEGATIVE,"model_revision":probe.MODEL_REVISION,"wan_commit":probe.WAN_COMMIT,
        "rife_weights_sha256":probe.RIFE_SHA,"model_reused":False}
    if any(report.get(k)!=v for k,v in expected.items()):
        raise ValueError("Worker body-acting contract differs")


def audit_take():
    plan=json.loads((OUT/"plan.json").read_text(encoding="utf-8"))
    request=request_for(plan)
    folder=OUT/"06"
    report=json.loads((folder/"qa.json").read_text(encoding="utf-8"))
    verify(report,request)
    with wave.open(str(ROOT/plan["shots"][0]["audio"])) as audio:
        reference=np.frombuffer(audio.readframes(audio.getnframes()),dtype="<i2").astype(np.float64)
    for name in ("native","fluid"):
        if digest((folder/f"{name}.mp4").read_bytes())!=report["outputs"][name]["sha256"]:
            raise ValueError("Generated take changed")
    conversation.save(folder/"av-audit.json",{name:auditor.audit(name,fps,count,reference,path=folder/f"{name}.mp4")
        for name,fps,count in (("native",16,80),("fluid",60,297))})


def run(available_credit):
    plan=json.loads((OUT/"plan.json").read_text(encoding="utf-8"))
    request=request_for(plan)
    folder=OUT/"06"
    if (folder/"qa.json").exists():
        audit_take(); logger.info("Completed take verified, no cloud call"); return
    lock=folder/"generation.lock.json"
    if lock.exists() or (folder/"failure.json").exists() or any((folder/f"{n}.mp4").exists() for n in ("native","fluid")):
        raise ValueError("Partial/reserved experiment requires inspection; never retry automatically")
    if available_credit is None or not available_credit.is_finite() or available_credit < REQUIRED:
        raise ValueError("Insufficient confirmed remaining credit for one bounded take")
    with lock.open("x",encoding="utf-8") as f:
        json.dump({"max_new_gpu_calls":1,"available_credit_reported":str(available_credit),
            "reserved_allowance_usd":str(REQUIRED),"worker_timeout_seconds":TIMEOUT},f)
    started,app_id=time.perf_counter(),None
    try:
        conversation.credentials()
        with modal.enable_output(),probe.app.run():
            app_id=probe.app.app_id
            conversation.save(folder/"running.json",{"modal_app_id":app_id})
            report=probe.receive_stream(probe.speak_body_h200.remote_gen(**request),folder,prefix="")
            verify(report,request)
            conversation.save(folder/"qa.json",{**report,"modal_app_id":app_id,
                "client_seconds":time.perf_counter()-started,"new_worker_seconds":report["worker_entry_seconds"],
                "new_worker_estimate_usd":float(RATE)*report["worker_entry_seconds"],"human_sample_approved":False})
        audit_take()
        lock.unlink()
    except Exception as exc:
        conversation.save(folder/"failure.json",{"modal_app_id":app_id,"error_type":type(exc).__name__,
            "client_seconds":time.perf_counter()-started})
        raise


if __name__=="__main__":
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,"reconfigure"): stream.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO)
    parser=argparse.ArgumentParser()
    action_parser=parser.add_mutually_exclusive_group(required=True)
    action_parser.add_argument("--prepare",action="store_true")
    action_parser.add_argument("--run",action="store_true")
    action_parser.add_argument("--audit",action="store_true")
    parser.add_argument("--available-credit-usd",type=Decimal)
    args=parser.parse_args()
    if args.prepare: prepare()
    elif args.audit: audit_take()
    else: run(args.available_credit_usd)
