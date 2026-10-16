import json
from pathlib import Path
import shutil
import tempfile
import unittest

from assemble_auray_sequence import assemble, command, probe, sha


class NativeMontageTest(unittest.TestCase):
    def test_puter_30fps_keeps_original_pixels_and_audio_without_rate_conversion(self):
        sources = []
        for i in range(3):
            path = self.directory / f"puter-{i}.mp4"
            command(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=90x160:r=30:d=1.2",
                     "-f", "lavfi", "-i", f"aevalsrc=0.25*sin(2*PI*({440+i*150}*t+80*t*t)):s=32000:d=1.2",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", str(path)])
            sources.append({"path": str(path), "sha256": sha(path), "speaker": f"puter-{i}"})
        with self.assertRaises(ValueError):
            assemble(sources, self.directory / "puter-wrong-grid")
        result = assemble(sources, self.directory / "puter-native", fps=30)
        self.assertEqual(result["frames"], 108)
        self.assertEqual(result["encoded_fps"], 30)
        self.assertAlmostEqual(result["seconds"], 3.6)
        self.assertTrue(result["all_decoded_frames_pixel_identical"])
        self.assertFalse(result["video_reencoded"])
        for cut in result["cuts"]:
            self.assertLess(abs(cut["audio_transport"]["measured_lag_seconds"]), .002)

    @classmethod
    def setUpClass(cls):
        cls.directory = Path(tempfile.mkdtemp(prefix="auray-native-montage-test-")).resolve()
        cls.sources = []
        for index, (color, frequency) in enumerate(zip(["red", "green", "blue"], [440, 770, 550])):
            path = cls.directory / f"source-{index}.mp4"
            command(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s=90x160:r=24:d=1.25",
                     "-f", "lavfi", "-i", f"aevalsrc=0.25*sin(2*PI*({frequency}*t+80*t*t)):s=32000:d=1.34",
                     "-vf", "setpts=PTS+2/24/TB", "-af", "asetpts='PTS+gte(N,1024)*0.051333/TB'",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-video_track_timescale", "12288",
                     "-c:a", "aac", "-ac", "2", str(path)])
            cls.sources.append({"path": str(path), "sha256": sha(path), "speaker": f"fixture-{index}"})

    @classmethod
    def tearDownClass(cls):
        # Verify the exact temporary directory before recursive cleanup on Windows.
        if cls.directory.parent != Path(tempfile.gettempdir()).resolve() or not cls.directory.name.startswith("auray-native-montage-test-"):
            raise RuntimeError("Unexpected cleanup target")
        shutil.rmtree(cls.directory)

    def test_real_ffmpeg_preserves_frames_and_voice_timing_across_aac_gaps(self):
        result = assemble(self.sources, self.directory / "assembled")
        self.assertEqual(result["frames"], 90)
        self.assertEqual(result["encoded_fps"], 24)
        self.assertAlmostEqual(result["seconds"], 3.75)
        self.assertTrue(result["all_decoded_frames_pixel_identical"])
        self.assertFalse(result["video_reencoded"])
        self.assertFalse(result["production_ready"])
        for cut in result["cuts"]:
            self.assertLess(abs(cut["audio_transport"]["measured_lag_seconds"]), .002)
            self.assertGreater(cut["audio_transport"]["correlation"], .97)
        video = next(s for s in probe(result["file"])["streams"] if s["codec_type"] == "video")
        self.assertEqual(float(video["start_time"]), 0)
        self.assertEqual([c["speaker"] for c in result["cuts"]], ["fixture-0", "fixture-1", "fixture-2"])

    def test_nine_takes_preserve_every_frame_and_native_audio(self):
        sources = [{**self.sources[i % 3], "speaker": f"take-{i}"} for i in range(9)]
        result = assemble(sources, self.directory / "nine-takes")
        self.assertEqual(result["frames"], 270)
        self.assertEqual(result["encoded_fps"], 24)
        self.assertAlmostEqual(result["seconds"], 11.25)
        self.assertTrue(result["all_decoded_frames_pixel_identical"])
        self.assertFalse(result["video_reencoded"])
        self.assertEqual([c["speaker"] for c in result["cuts"]], [f"take-{i}" for i in range(9)])
        for cut in result["cuts"]:
            self.assertLess(abs(cut["audio_transport"]["measured_lag_seconds"]), .002)
            self.assertGreater(cut["audio_transport"]["correlation"], .97)

    def test_changed_source_cannot_be_mounted(self):
        with self.assertRaisesRegex(ValueError, "identity changed"):
            assemble([{**self.sources[0], "sha256": "0"*64}, self.sources[1]], self.directory / "bad-hash")

    def test_missing_native_voice_cannot_be_replaced_by_silence(self):
        path = self.directory / "no-audio.mp4"
        command(["ffmpeg", "-y", "-v", "error", "-i", self.sources[0]["path"], "-map", "0:v:0", "-c:v", "copy", str(path)])
        with self.assertRaisesRegex(ValueError, "native video and audio"):
            assemble([{"path": str(path), "sha256": sha(path), "speaker": "missing"}, self.sources[1]], self.directory / "bad-audio")


if __name__ == "__main__":
    unittest.main()
