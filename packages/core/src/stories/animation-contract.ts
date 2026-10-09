import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** This is the qualified first production format, not the generic provider catalog. */
export const animatedOutputSchema = z.object({
  version: z.literal("1.0.0"), profile_sha256: sha,
  orientation: z.literal("portrait"), width: z.literal(704), height: z.literal(1280),
  output_fps: z.literal(60), native_fps: z.literal(16), native_frames: z.literal(64), output_frames: z.literal(237),
}).strict();
export const animatedSceneSchema = z.object({
  shot_id: z.string().regex(/^[a-z0-9_-]{1,64}$/), character_id: z.string().min(1).max(24),
  reference_path: z.string().min(1).max(1024), reference_sha256: sha,
  audio_path: z.string().min(1).max(1024), audio_sha256: sha,
  audio_seconds: z.number().positive().max(63 / 16), voice_sha256: sha,
  prompt: z.string().trim().min(40).max(2400), seed: z.number().int().min(0).max(2147483647),
}).strict();
export const ANIMATED_SHOT_SECONDS = 237 / 60;
export const ANIMATED_CHAPTER_SECONDS = { min: 5 * ANIMATED_SHOT_SECONDS, max: 8 * ANIMATED_SHOT_SECONDS } as const;
