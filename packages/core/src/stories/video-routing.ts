import { z } from "zod";

/** A shot is not an episode. Episode duration/state/approval contracts stay unchanged. */
export const videoShotSchema = z.object({
  version: z.literal("1.0.0"),
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  kind: z.enum(["action", "reaction", "dialogue"]),
  reference_path: z.string().min(1).max(1024),
  reference_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prompt: z.string().trim().min(40).max(2400),
  seconds: z.number().finite().min(1).max(5),
  seed: z.number().int().min(0).max(2147483647),
  audio_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  audio_path: z.string().min(1).max(1024).optional(),
  // Preview is explicit: never silently deliver the cheaper model as the approved master.
  quality: z.enum(["preview", "approved_master"]),
  min_short_edge: z.number().int().min(480).max(2160),
  min_output_fps: z.number().int().min(16).max(60),
}).strict().superRefine((v, ctx) => {
  if ((v.kind === "dialogue") !== Boolean(v.audio_sha256))
    ctx.addIssue({ code: "custom", message: "Somente diálogo exige o hash do áudio sincronizado" });
  if (v.audio_path && v.kind !== "dialogue")
    ctx.addIssue({ code: "custom", message: "Áudio condicionado só é aceito no diálogo" });
});
export type VideoShot = z.infer<typeof videoShotSchema>;

export interface VideoProvider {
  id: string;
  quota_group: string;
  capabilities: VideoShot["kind"][];
  quality: VideoShot["quality"][];
  short_edge: number;
  output_fps: number;
  max_seconds: number;
  available: boolean;
  checked_at: number;
  cooldown_until: number;
  // No USD/Pollen/quota-seconds conversion. Each provider uses its own unit.
  free_remaining: number | null;
  billing: "free_service" | "credits";
  reserved: number;
  required: number;
  cash_cost: number;
  adapter_ready: boolean;
}

/** Pure preflight; a dispatcher must reserve atomically before submitting. */
export function routeVideoShot(raw: unknown, providers: VideoProvider[], now = Date.now()) {
  const shot = videoShotSchema.parse(raw);
  if (!Number.isFinite(now)) throw new Error("Relógio inválido");
  const reasons: Array<{ provider: string; reason: string }> = [];
  const eligible: VideoProvider[] = [];
  const seen = new Set<string>();
  for (const p of providers) {
    let reason: string | undefined;
    if (!p.adapter_ready || !p.available) reason = "unavailable";
    else if (!Number.isFinite(p.checked_at) || now < p.checked_at || now - p.checked_at > 300_000) reason = "stale_capacity";
    else if (!Number.isFinite(p.cooldown_until) || p.cooldown_until > now) reason = "cooldown";
    else if (p.cash_cost !== 0) reason = "cash_not_allowed";
    else if (!p.capabilities.includes(shot.kind)) reason = "incompatible_task";
    else if (!p.quality.includes(shot.quality) || p.short_edge < shot.min_short_edge ||
      p.output_fps < shot.min_output_fps || p.max_seconds < shot.seconds) reason = "quality_contract";
    else if ((p.free_remaining === null && p.billing !== "free_service") ||
      (p.free_remaining !== null && (!Number.isFinite(p.free_remaining) || p.free_remaining < 0)) ||
      !Number.isFinite(p.required) || p.required <= 0 || !Number.isFinite(p.reserved) || p.reserved < 0) reason = "unknown_capacity";
    else if (p.free_remaining !== null && p.free_remaining - p.reserved < p.required) reason = "free_quota_exhausted";
    else if (seen.has(p.quota_group)) reason = "shared_quota";
    if (reason) reasons.push({ provider: p.id, reason });
    else { seen.add(p.quota_group); eligible.push(p); }
  }
  return { selected: eligible[0]?.id ?? null, alternatives: eligible.slice(1).map(p => p.id), reasons };
}

/** Unknown/accepted jobs must be reconciled, not submitted to another provider. */
export function canFallback(outcome: "rejected_before_acceptance" | "completed" | "accepted" | "unknown") {
  return outcome === "rejected_before_acceptance";
}
