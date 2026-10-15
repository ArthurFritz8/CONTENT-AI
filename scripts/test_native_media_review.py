import importlib.util
from pathlib import Path
import tempfile
import unittest
import hashlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("review_native_media",Path(__file__).with_name("review_native_media.py"))
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

class NativeMediaReviewTests(unittest.TestCase):
 def test_speech_accents_punctuation_and_changes(self):
  self.assertEqual(review.speech_status("Essa passagem é sua.","Essa passagem e sua!"),"no_mismatch_detected")
  self.assertEqual(review.speech_status("Essa passagem é sua.","Ah, olha, essa passagem é sua."),"possible_extra_speech")
  self.assertEqual(review.speech_status("Essa passagem é sua.","Essa passagem."),"possible_missing_speech")
  self.assertEqual(review.speech_status("Essa passagem é sua.",""),"possible_missing_speech")
 def test_color_uses_chromatic_clothing_area_and_is_only_a_hint(self):
  red=bytes([180,20,20])*96*168;green=bytes([20,180,20])*96*168;dark_red=bytes([100,12,12])*96*168
  a,amount=review.color_signature(red);b,_=review.color_signature(green);c,_=review.color_signature(dark_red)
  self.assertGreater(amount,.99);self.assertGreater(review.color_distance(a,b),.9);self.assertEqual(review.color_distance(a,c),0)
  gray=bytes([100,100,100])*96*168;_,coverage=review.color_signature(gray);self.assertEqual(coverage,0)
 def test_changed_private_bytes_are_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"clip.mp4";p.write_bytes(b"original")
   self.assertEqual(review.checked_bytes(p,hashlib.sha256(b"original").hexdigest()),p.resolve())
   with self.assertRaises(ValueError):review.checked_bytes(p,"a"*64)
 def test_unavailable_checks_are_not_reported_as_passed(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"clip.mp4";p.write_bytes(b"fixture");sha=hashlib.sha256(b"fixture").hexdigest()
   manifest={"episode_id":"11111111-1111-4111-8111-111111111111","video_path":str(p),"video_sha256":sha,"takes":[{"path":str(p),"sha256":sha,"speaker":"malu","expected_text":"Onde está a passagem?"}]*3}
   with patch.object(review,"load_speech_model",side_effect=ImportError),patch.object(review,"appearance",side_effect=ValueError):
    report=review.review(manifest)
   self.assertEqual(report['speech_engine'],'unavailable');self.assertFalse(report['lip_sync_verified']);self.assertFalse(report['identity_verified'])
   self.assertTrue(all(t['speech_status']=='unavailable' and t['appearance_status']=='unavailable' for t in report['takes']))

if __name__=="__main__":unittest.main()
