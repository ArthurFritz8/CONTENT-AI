import {z} from "zod";
import {planProductionQueue,type ProductionQueueEntry} from "../../../packages/core/src/stories/production.ts";
import {videoShotSchema} from "../../../packages/core/src/stories/video-routing.ts";

const amount=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quote=z.object({provider_id:z.string(),execution_sha256:z.string(),units:amount.positive(),cash_cost:z.literal(0)});
const entrySchema=z.object({id:z.string().uuid(),series_id:z.string().uuid(),title:z.string().max(300),chapter_number:z.number().int().min(1).max(60),
 priority:amount,created_at:z.number().finite().nonnegative(),queue_id:z.string().uuid().nullable(),revision:amount,
 state:z.enum(["prepared","pending","reserved"]),profile_sha256:z.string().regex(/^[a-f0-9]{64}$/),previous_approved:z.boolean(),
 blocked_code:z.string().nullable(),shots:z.array(z.object({shot:z.unknown(),quotes:z.array(quote)})).max(100)});
const providerSchema=z.object({id:z.string(),label:z.string().max(80),quota_group:z.string(),capabilities:z.array(z.enum(["dialogue","action","reaction"])),
 quality:z.array(z.enum(["approved_master","preview"])),short_edge:z.number(),output_fps:z.number(),max_seconds:z.number(),available:z.boolean(),
 adapter_ready:z.boolean(),checked_at:z.number(),cooldown_until:z.number(),free_remaining:amount.nullable(),billing:z.enum(["credits","free_service"]),
 free_tier:z.enum(["recurring","permanent","trial","unknown"]),reserved:amount,required:amount.positive(),cash_cost:z.literal(0),execution_sha256:z.string(),
 continuity_approvals:z.array(z.object({series_id:z.string().uuid(),profile_sha256:z.string(),execution_sha256:z.string(),capabilities:z.array(z.enum(["dialogue","action","reaction"]))}))});
const snapshotSchema=z.object({checked_at:z.number().finite().nonnegative().optional(),entries:z.array(entrySchema).max(101),providers:z.array(providerSchema),wallets:z.array(z.object({quota_group:z.string(),unit:z.string(),
 remaining_units:amount,held_units:amount,checked_at:z.number(),valid_until:z.number()})),queue:z.object({cursor_revision:amount,after_quota_group:z.string().nullable(),reservation_enabled:z.boolean()})});
export const queueCommandSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("enqueue"),episodeId:z.string().uuid(),requestId:z.string().uuid()}).strict(),
 z.object({action:z.literal("cancel"),queueId:z.string().uuid(),revision:amount}).strict(),
]);

function prepared(entry:z.infer<typeof entrySchema>) {
 return entry.shots.length>=5 && entry.shots.length<=8 && entry.shots.every(item=>videoShotSchema.safeParse(item.shot).success);
}
export function queueEnqueueTarget(raw:unknown,episodeId:string) {
 const snapshot=snapshotSchema.parse(raw),entry=snapshot.entries.find(row=>row.id===episodeId);
 if(!entry || !["prepared","pending"].includes(entry.state) || !prepared(entry))return null;
 return {episode_id:entry.id,profile_sha256:entry.profile_sha256};
}
export function videoQueuePreview(raw:unknown,clock?:number) {
 const snapshot=snapshotSchema.parse(raw),truncated=snapshot.entries.length>100,entries=snapshot.entries.slice(0,100);
 const now=clock??snapshot.checked_at??Date.now();
 const waitingCodes=new Set(["script_changed","existing_video_work","waiting_previous_chapter"]);
 const eligible=entries.filter(entry=>entry.state==="pending" && prepared(entry) && !waitingCodes.has(entry.blocked_code??""));
 const plan=planProductionQueue(truncated?[]:eligible as ProductionQueueEntry[],snapshot.providers,snapshot.wallets,now,snapshot.queue.after_quota_group);
 const decisions=new Map(plan.decisions.map(decision=>[decision.chapter_id,decision]));
 return {items:entries.map(entry=>{
  const decision=decisions.get(entry.id),valid=prepared(entry);
  const status=entry.state==="reserved"?"reserved":!valid?"awaiting_preparation":entry.state==="prepared"?"prepared":
   waitingCodes.has(entry.blocked_code??"")?entry.blocked_code!:decision?.status??"planning_unavailable";
  return {episode_id:entry.id,queue_id:entry.queue_id,series_id:entry.series_id,title:entry.title,chapter_number:entry.chapter_number,
   revision:entry.revision,state:entry.state,status,can_enqueue:entry.state==="prepared"&&valid,
   source_label:snapshot.providers.find(provider=>provider.id===decision?.provider_id)?.label??null,
   reasons:[...new Set(decision?.reasons.map(reason=>reason.reason)??[])]};
 }),estimated_complete_chapters:plan.estimated_complete_chapters,estimated_new_animated_seconds:plan.estimated_new_animated_seconds,
 checked_at:now,cursor_revision:snapshot.queue.cursor_revision,reservation_enabled:snapshot.queue.reservation_enabled,
 estimate:true,dispatch_enabled:false,truncated};
}