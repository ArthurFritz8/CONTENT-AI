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
const queueEntrySchema=z.object({
  id:z.string().trim().min(1).max(100),series_id:z.string().uuid(),chapter_number:z.number().int().min(1).max(60),
  priority:z.number().int().min(0).max(1_000_000),created_at:z.number().finite().nonnegative(),previous_approved:z.boolean(),
  pinned_provider_id:z.string().trim().min(1).max(100).optional(),
  attempt:z.object({provider_id:z.string().trim().min(1).max(100),outcome:z.enum(["rejected_before_acceptance","accepted","unknown","completed"])}).strict().optional(),
});
export interface ProductionQueueEntry extends ProductionChapter {
  series_id:string;chapter_number:number;priority:number;created_at:number;previous_approved:boolean;
  pinned_provider_id?:string;attempt?:{provider_id:string;outcome:"rejected_before_acceptance"|"accepted"|"unknown"|"completed"};
}
export type ProductionQueueStatus="planned"|"waiting_capacity"|"waiting_review"|"waiting_previous_chapter"|"reconciliation_required";
export interface ProductionQueueDecision {
  chapter_id:string;series_id:string;status:ProductionQueueStatus;provider_id:string|null;quota_group:string|null;
  reasons:Array<{provider:string;reason:string}>;
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

export function planProductionQueue(entries:ProductionQueueEntry[],providers:VideoProvider[],wallets:WalletSnapshot[],now=Date.now(),afterQuotaGroup:string|null=null) {
  quoteSeriesProduction([],providers,wallets,now);
  if(afterQuotaGroup!==null)z.string().trim().min(1).max(200).parse(afterQuotaGroup);
  const chapterIds=new Set<string>(),seriesNumbers=new Set<string>(),earliest=new Map<string,number>();
  const queue=entries.map(entry=>{
    const metadata=queueEntrySchema.parse(entry),identity=`${metadata.series_id}:${metadata.chapter_number}`;
    if(metadata.created_at>now || chapterIds.has(metadata.id) || seriesNumbers.has(identity))throw Error("Fila duplicada ou data futura");
    chapterIds.add(metadata.id);seriesNumbers.add(identity);
    if(!entry.shots.length || entry.shots.length>100)throw Error("Capitulo sem tomadas ou acima do limite");
    const shots=entry.shots.map(item=>videoShotSchema.parse(item.shot));
    if(shots.some(shot=>shot.quality!=="approved_master" || shot.continuity?.series_id!==metadata.series_id) ||
      new Set(shots.map(shot=>shot.continuity?.profile_sha256)).size!==1 || new Set(shots.map(shot=>shot.id)).size!==shots.length)
      throw Error("Fila exige perfil aprovado unico e tomadas distintas da mesma novela");
    earliest.set(metadata.series_id,Math.min(earliest.get(metadata.series_id)??Infinity,metadata.chapter_number));
    return {...metadata,shots:entry.shots};
  }).sort((left,right)=>left.priority-right.priority || left.created_at-right.created_at || (left.id<right.id?-1:left.id>right.id?1:0));
  const activeSeries=new Set(queue.filter(entry=>entry.attempt && entry.attempt.outcome!=="rejected_before_acceptance").map(entry=>entry.series_id));
  const unsettledWallets=new Set(queue.filter(entry=>entry.attempt && ["accepted","unknown"].includes(entry.attempt.outcome))
    .map(entry=>providers.find(provider=>provider.id===entry.attempt!.provider_id)?.quota_group).filter((group):group is string=>group!==undefined));
  let snapshots=wallets.map(wallet=>({...wallet})),cursor=afterQuotaGroup;
  const decisions:ProductionQueueDecision[]=[],allocations:ReturnType<typeof quoteSeriesProduction>["allocations"]=[];
  for(const entry of queue) {
    const decision:ProductionQueueDecision={chapter_id:entry.id,series_id:entry.series_id,status:"waiting_capacity",provider_id:null,quota_group:null,reasons:[]};
    if(entry.attempt && entry.attempt.outcome!=="rejected_before_acceptance") {
      decision.status=entry.attempt.outcome==="completed"?"waiting_review":"reconciliation_required";
      decision.provider_id=entry.attempt.provider_id;
    } else if(activeSeries.has(entry.series_id) || entry.chapter_number!==earliest.get(entry.series_id))decision.status="waiting_previous_chapter";
    else if(entry.chapter_number>1 && !entry.previous_approved)decision.status="waiting_review";
    else {
      const offers: Array<{provider:VideoProvider;quote:ReturnType<typeof quoteSeriesProduction>}>=[];
      const rejectedGroup=entry.attempt ? providers.find(provider=>provider.id===entry.attempt!.provider_id)?.quota_group : undefined;
      for(const provider of providers) {
        if(unsettledWallets.has(provider.quota_group)) {
          decision.reasons.push({provider:provider.id,reason:"wallet_reconciliation_required"});continue;
        }
        if(entry.pinned_provider_id && entry.pinned_provider_id!==provider.id) {
          decision.reasons.push({provider:provider.id,reason:"source_pinned"});continue;
        }
        if(entry.attempt && (entry.attempt.provider_id===provider.id || rejectedGroup===provider.quota_group)) {
          decision.reasons.push({provider:provider.id,reason:"previous_rejection_no_retry"});continue;
        }
        const quote=quoteSeriesProduction([entry],[provider],snapshots,now);
        if(quote.estimated_complete_chapters===1)offers.push({provider,quote});
        else decision.reasons.push(...quote.rejected.flatMap(row=>row.reasons));
      }
      const byProvider=new Map(offers.map(offer=>[offer.provider.id,offer]));
      const candidates=providers.map(provider=>{
        const offer=byProvider.get(provider.id);
        if(!offer)return {...provider,available:false};
        const total=offer.quote.allocations.reduce((sum,row)=>sum+row.units,0);
        return {...provider,billing:"credits" as const,free_remaining:total,required:total,reserved:0,cash_cost:0};
      });
      const routing=routeVideoShot(entry.shots[0]!.shot,candidates,now,cursor);
      const offer=offers.find(row=>row.provider.id===routing.selected);
      if(offer) {
        decision.status="planned";decision.provider_id=offer.provider.id;decision.quota_group=offer.provider.quota_group;
        allocations.push(...offer.quote.allocations);cursor=offer.provider.quota_group;
        snapshots=snapshots.map(wallet=>offer.quote.remaining_by_wallet[wallet.quota_group]===undefined?wallet:{...wallet,
          remaining_units:offer.quote.remaining_by_wallet[wallet.quota_group]!+wallet.held_units});
      }
    }
    decisions.push(decision);
  }
  const remaining=quoteSeriesProduction([],providers,snapshots,now).remaining_by_wallet;
  return {decisions,allocations,estimated_complete_chapters:decisions.filter(row=>row.status==="planned").length,
    estimated_new_animated_seconds:allocations.reduce((sum,row)=>sum+row.seconds,0),remaining_by_wallet:remaining,
    proposed_after_quota_group:cursor,checked_at:now,estimate:true as const,dispatch_enabled:false as const};
}
