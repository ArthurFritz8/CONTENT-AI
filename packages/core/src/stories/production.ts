import { z } from "zod";
import { canonicalStringify, sha256Hex } from "../validators/hash-utils.ts";
import { routeVideoShot, videoShotSchema, type VideoProvider } from "./video-routing.ts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** Identity is independent of GPU host; execution approvals are bound separately. */
export const seriesProductionProfileSchema = z.object({
  version: z.literal("1.0.0"),
  orientation: z.enum(["portrait", "landscape"]),
  short_edge: z.number().int().min(480).max(2160),
  output_fps: z.number().int().min(24).max(60),
  style: z.string().trim().min(30).max(3000),
  references: z.array(z.object({ character_id: z.string().min(1).max(24), path: z.string().min(1).max(1024), sha256: sha }).strict()).min(2).max(32),
  voices: z.array(z.object({ character_id: z.string().min(1).max(24), engine: z.string().min(1).max(80),
    voice_id: z.string().min(1).max(100), version: z.string().min(1).max(100), sample_sha256: sha }).strict()).min(2).max(8),
}).strict().superRefine((p, ctx) => {
  const characters = new Set(p.references.map(r => r.character_id));
  const voices = new Set(p.voices.map(v => v.character_id));
  if (voices.size !== p.voices.length || [...characters].some(id => !voices.has(id)) || [...voices].some(id => !characters.has(id)))
    ctx.addIssue({ code: "custom", message: "Cada personagem exige referências e uma voz versionada" });
});
export async function productionProfileHash(raw: unknown) {
  return sha256Hex(canonicalStringify(seriesProductionProfileSchema.parse(raw)));
}

export interface ShotQuote { provider_id: string; execution_sha256: string; units: number; cash_cost: number }
export interface ProductionChapter { id: string; shots: Array<{ shot: unknown; quotes: ShotQuote[] }> }
export interface WalletSnapshot {
  quota_group: string; unit: string; remaining_units: number; held_units: number;
  checked_at: number; valid_until: number;
}

/** Conservative sequential allocation. Units stay in their own shared wallet.
 * Quotes include bounded retry/overhead reserves and all required production stages.
 * A partially affordable chapter contributes no capacity and consumes no simulated balance.
 * This computes a proposal; the database must revalidate and reserve before dispatch.
 */
export function quoteSeriesProduction(chapters: ProductionChapter[], providers: VideoProvider[], wallets: WalletSnapshot[], now = Date.now()) {
  if (!Number.isFinite(now)) throw Error("Relógio inválido");
  if (new Set(providers.map(p => p.id)).size !== providers.length) throw Error("Provedor duplicado");
  if (new Set(wallets.map(w => w.quota_group)).size !== wallets.length) throw Error("Carteira duplicada; agrupe a cota compartilhada");
  if (new Set(chapters.map(c => c.id)).size !== chapters.length) throw Error("Capítulo duplicado");
  const balances = new Map<string, number>();
  for (const w of wallets) {
    const valid = Number.isSafeInteger(w.remaining_units) && w.remaining_units >= 0 && Number.isSafeInteger(w.held_units) && w.held_units >= 0 &&
      Number.isFinite(w.checked_at) && w.checked_at <= now && now - w.checked_at <= 300_000 &&
      Number.isFinite(w.valid_until) && w.valid_until > now && !!w.unit;
    if (valid) balances.set(w.quota_group, Math.max(0, w.remaining_units - w.held_units));
  }
  const allocations: Array<{ chapter_id: string; shot_id: string; provider_id: string; quota_group: string; units: number; seconds: number }> = [];
  const rejected: Array<{ chapter_id: string; shot_id: string; reasons: Array<{ provider: string; reason: string }> }> = [];
  let completeChapters = 0;
  for (const chapter of chapters) {
    if (!chapter.shots.length) throw Error("Capítulo sem tomadas");
    const draft = new Map(balances), selected: typeof allocations = [], ids = new Set<string>();
    let failed = false;
    for (const item of chapter.shots) {
      const shot = videoShotSchema.parse(item.shot);
      if (!shot.continuity || shot.quality !== "approved_master") throw Error("Capacidade produtiva exige perfil da novela e qualidade aprovada");
      if (ids.has(shot.id)) throw Error("Tomada duplicada");
      ids.add(shot.id);
      const candidates = providers.map(p => {
        const matches = item.quotes.filter(q => q.provider_id === p.id && q.execution_sha256 === p.execution_sha256);
        const q = matches.length === 1 ? matches[0] : undefined;
        const amountValid = q && Number.isSafeInteger(q.units) && q.units > 0;
        return { ...p, billing: "credits" as const, free_remaining: draft.get(p.quota_group) ?? null,
          reserved: 0, required: amountValid ? q.units : NaN, cash_cost: q?.cash_cost ?? NaN };
      });
      const result = routeVideoShot(shot, candidates, now);
      const p = candidates.find(p => p.id === result.selected);
      if (!p) {
        rejected.push({ chapter_id: chapter.id, shot_id: shot.id, reasons: result.reasons });
        failed = true; break;
      }
      draft.set(p.quota_group, draft.get(p.quota_group)! - p.required);
      selected.push({ chapter_id: chapter.id, shot_id: shot.id, provider_id: p.id, quota_group: p.quota_group, units: p.required, seconds: shot.seconds });
    }
    // Continuation cannot skip an unaffordable earlier chapter.
    if (failed) break;
    balances.clear(); for (const [group, remaining] of draft) balances.set(group, remaining);
    allocations.push(...selected); completeChapters++;
  }
  return { estimated_complete_chapters: completeChapters, estimated_new_animated_seconds: allocations.reduce((n, a) => n + a.seconds, 0),
    allocations, rejected, remaining_by_wallet: Object.fromEntries(balances), estimate: true as const, checked_at: now };
}
