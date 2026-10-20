import {z} from "zod";
import {planProductionQueue,type ProductionQueueEntry} from "../../../packages/core/src/stories/production.ts";
import {videoShotSchema} from "../../../packages/core/src/stories/video-routing.ts";
import {NATIVE_PUTER,puterBudget} from "../../../packages/core/src/stories/puter-contract.ts";

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
const puterEntrySchema=entrySchema.omit({shots:true}).extend({shots:z.number().int().min(1).max(9),prepared:z.boolean(),profile_ready:z.boolean()});
const puterSnapshotSchema=z.object({entries:z.array(puterEntrySchema).max(101),accounts:z.array(z.object({id:z.string().uuid(),checked_at:z.string().nullable(),
 remaining_credits:z.number().finite().nonnegative().nullable(),balance_fresh:z.boolean(),financially_eligible:z.boolean().nullable(),reserved:z.boolean(),busy:z.boolean()})),checked_at:z.number().finite()});
const snapshotSchema=z.object({puter:puterSnapshotSchema.optional(),checked_at:z.number().finite().nonnegative().optional(),entries:z.array(entrySchema).max(101),providers:z.array(providerSchema),wallets:z.array(z.object({quota_group:z.string(),unit:z.string(),
 remaining_units:amount,held_units:amount,checked_at:z.number(),valid_until:z.number()})),queue:z.object({cursor_revision:amount,after_quota_group:z.string().nullable(),reservation_enabled:z.boolean()})});
export const queueCommandSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("enqueue"),episodeId:z.string().uuid(),requestId:z.string().uuid()}).strict(),
 z.object({action:z.literal("cancel"),queueId:z.string().uuid(),revision:amount}).strict(),
]);

function prepared(entry:z.infer<typeof entrySchema>) {
 return entry.shots.length>=5 && entry.shots.length<=8 && entry.shots.every(item=>videoShotSchema.safeParse(item.shot).success);
}
export function queueEnqueueTarget(raw:unknown,episodeId:string) {
 const snapshot=snapshotSchema.parse(raw),native=snapshot.puter?.entries.find(row=>row.id===episodeId);
 if(native)return native.prepared&&native.profile_ready&&native.shots===3&&!native.blocked_code&&["prepared","pending"].includes(native.state)?{episode_id:native.id,profile_sha256:native.profile_sha256}:null;
 const entry=snapshot.entries.find(row=>row.id===episodeId);
 if(!entry || !["prepared","pending"].includes(entry.state) || !prepared(entry))return null;
 return {episode_id:entry.id,profile_sha256:entry.profile_sha256};
}
export function videoQueuePreview(raw:unknown,clock?:number) {
 const snapshot=snapshotSchema.parse(raw),truncated=snapshot.entries.length+(snapshot.puter?.entries.length??0)>100,entries=snapshot.entries.slice(0,100);
 const now=clock??snapshot.checked_at??Date.now();
 const waitingCodes=new Set(["script_changed","existing_video_work","waiting_previous_chapter"]);
 const eligible=entries.filter(entry=>entry.state==="pending" && prepared(entry) && !waitingCodes.has(entry.blocked_code??""));
 const plan=planProductionQueue(truncated?[]:eligible as ProductionQueueEntry[],snapshot.providers,snapshot.wallets,now,snapshot.queue.after_quota_group);
 const decisions=new Map(plan.decisions.map(decision=>[decision.chapter_id,decision]));
 const genericItems=entries.map(entry=>{
  const decision=decisions.get(entry.id),valid=prepared(entry);
  const status=entry.state==="reserved"?"reserved":!valid?"awaiting_preparation":entry.state==="prepared"?"prepared":
   waitingCodes.has(entry.blocked_code??"")?entry.blocked_code!:decision?.status??"planning_unavailable";
  return {episode_id:entry.id,queue_id:entry.queue_id,series_id:entry.series_id,title:entry.title,chapter_number:entry.chapter_number,
   revision:entry.revision,state:entry.state,status,can_enqueue:entry.state==="prepared"&&valid,
  can_cancel:entry.state==="pending",budget:null as null|ReturnType<typeof puterBudget>,
  source_label:snapshot.providers.find(provider=>provider.id===decision?.provider_id)?.label??null,
   reasons:[...new Set(decision?.reasons.map(reason=>reason.reason)??[])]};
 });
 const native=previewPuterQueue(snapshot.puter,truncated);
 const order=new Map([...entries,...snapshot.puter?.entries??[]].map(entry=>[entry.id,entry]));
 const items=[...genericItems,...native.items].sort((left,right)=>{const a=order.get(left.episode_id)!,b=order.get(right.episode_id)!;
  return a.priority-b.priority||a.created_at-b.created_at||(a.id<b.id?-1:a.id>b.id?1:0);}).slice(0,100);
 return {items,estimated_complete_chapters:plan.estimated_complete_chapters+native.chapters,estimated_new_animated_seconds:plan.estimated_new_animated_seconds+native.chapters*15,
 checked_at:now,cursor_revision:snapshot.queue.cursor_revision,reservation_enabled:snapshot.queue.reservation_enabled,
 estimate:true,dispatch_enabled:false,truncated};
}

function previewPuterQueue(snapshot:z.infer<typeof puterSnapshotSchema>|undefined,truncated:boolean) {
 const balances=new Map(snapshot?.accounts.map(account=>[account.id,account.remaining_credits])??[]);
 const earliest=new Map<string,number>();let chapters=0;
 for(const entry of snapshot?.entries??[])if(!entry.blocked_code)earliest.set(entry.series_id,Math.min(earliest.get(entry.series_id)??Infinity,entry.chapter_number));
 const items=[...snapshot?.entries??[]].sort((left,right)=>left.priority-right.priority||left.created_at-right.created_at||(left.id<right.id?-1:left.id>right.id?1:0)).map(entry=>{
  const valid=entry.prepared&&entry.profile_ready&&entry.shots===3;
  const recent=snapshot!.accounts.filter(account=>account.balance_fresh&&account.checked_at!==null&&
   Date.parse(account.checked_at)<=snapshot!.checked_at&&snapshot!.checked_at-Date.parse(account.checked_at)<=120000);
  const fresh=recent.filter(account=>account.financially_eligible);
  const free=fresh.filter(account=>!account.reserved&&!account.busy);
  const funded=free.find(account=>(puterBudget(3,balances.get(account.id)??null).estimated_chapters??0)>0);
  const available=free.reduce<number|null>((best,account)=>{const remaining=balances.get(account.id)??null;return remaining!==null&&(best===null||remaining>best)?remaining:best;},null);
  const status=entry.blocked_code??(!valid?"awaiting_preparation":!entry.previous_approved?"waiting_review":entry.chapter_number!==earliest.get(entry.series_id)?"waiting_previous_chapter":
  truncated?"planning_unavailable":funded?entry.state==="pending"?"planned":"prepared":snapshot!.accounts.length===0?"connection_required":
  recent.length===0?"waiting_balance":fresh.length===0?"source_not_ready":free.length===0?"wallet_reconciliation_required":"insufficient_capacity");
  if(status==="planned"&&funded){balances.set(funded.id,puterBudget(3,balances.get(funded.id)??null,NATIVE_PUTER.creditsPerShot*3).available_credits);chapters++;}
  return {episode_id:entry.id,queue_id:entry.queue_id,series_id:entry.series_id,title:entry.title,chapter_number:entry.chapter_number,
   revision:entry.revision,state:entry.state,status,can_enqueue:entry.state==="prepared"&&valid&&!entry.blocked_code,
  can_cancel:entry.state==="pending"&&!["reserved","reconciliation_required","cancellation_pending","waiting_review","cancelled","completed","existing_video_work"].includes(entry.blocked_code??""),
  source_label:"Puter",reasons:[] as string[],budget:entry.shots===3?puterBudget(3,available):null};
 });
 return {items,chapters};
}