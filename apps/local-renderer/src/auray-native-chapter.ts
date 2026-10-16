/** Durable native-dialogue executor. No fallback provider, episode approval or publishing. */
import {z} from "zod";
import {nativeProfileSchema,nativeDraftSchema} from "../../../packages/core/src/stories/native-contract.ts";
import {storyContextSchema,nativeShotCount} from "../../../packages/core/src/stories/schema.ts";
import {nativeFingerprint,nativeShot,validateNativeDraft} from "../../../packages/core/src/stories/native-chapter.ts";
import {AurayError,aurayAuditionKey,aurayAuditionSchema,type AurayVideoProvider,type AurayInspection} from "./auray-video-provider.ts";

const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeClipSchema=z.object({request_key:sha,sha256:sha,frames:z.number().int().min(116).max(124),path:z.string().max(500)}).strict();
export type NativeClip=z.infer<typeof nativeClipSchema>;
export const nativeReuseSchema=z.object({index:z.number().int().min(0).max(8),episode_id:z.string().uuid(),clip:nativeClipSchema}).strict();
const taskSchema=z.object({request_key:sha,job_id:z.string().regex(/^video_[a-f0-9]{64}$/),
  phase:z.enum(["planned","submission_started","submitted","submission_unknown","rejected","waiting","failed","ready"]),
  charged_credits:z.number().int().min(0).max(5),settled:z.boolean(),clip:nativeClipSchema.nullable(),error_code:z.string().regex(/^[a-z_]{1,80}$/).nullable(),
  rate_limit_retries:z.literal(1).optional(),
  reused:nativeReuseSchema.optional(),
}).strict();
export const nativeRunSchema=z.object({version:z.literal(1),episode_id:z.string().uuid(),fingerprint:sha,
  reserved_at:z.string().datetime(),
  profile:nativeProfileSchema,context:storyContextSchema,draft:nativeDraftSchema,
  account_id:z.string().uuid(),key_id:z.string().min(1).max(200),period:z.string().regex(/^\d{4}-\d{2}$/),contract_sha256:sha,
  initial_plan_remaining:z.number().int().min(5),initial_key_remaining:z.number().int().min(5),reserved_credits:z.union([z.literal(5),z.literal(15),z.literal(30),z.literal(45)]),
  tasks:z.array(taskSchema).min(3).max(9),revision:z.number().int().nonnegative(),
  not_before:z.string().datetime().nullable().optional(),
  output:z.object({path:z.string().max(500),sha256:sha,bytes:z.number().int().positive().max(50*1024*1024),
    script_path:z.string().max(500),script_sha256:sha,qa_path:z.string().max(500),qa_sha256:sha}).strict().nullable(),
  budget_reconciled:z.boolean(),
}).strict();
export type NativeRun=z.infer<typeof nativeRunSchema>;

function currentFree(report:AurayInspection,now:number) {
  const age=now-Date.parse(report.checked_at);
  return Number.isFinite(age) && age>=0 && age<=120_000 && report.blockers.every(b=>b==="insufficient_free_credits") &&
    report.plan_remaining!==null && report.key_remaining!==null && report.contract_sha256!==null && report.period===new Date(now).toISOString().slice(0,7);
}
export async function createNativeRun(input:{episode_id:string;profile:unknown;context:unknown;draft:unknown;reuse?:Array<z.infer<typeof nativeReuseSchema>>},report:AurayInspection,now=Date.now()):Promise<NativeRun> {
  const profile=nativeProfileSchema.parse(input.profile),context=storyContextSchema.parse(input.context),draft=validateNativeDraft(input.draft,context,profile);
  const count=nativeShotCount(context),reuse=z.array(nativeReuseSchema).max(count-1).parse(input.reuse??[]),needed=(count-reuse.length)*5;
  if(reuse.length!==0&&reuse.length!==count-1 || new Set(reuse.map(r=>r.index)).size!==reuse.length || reuse.some(r=>r.index>=count || r.episode_id===input.episode_id || r.clip.path!==`episodes/${r.episode_id}/native/${r.clip.sha256}.mp4`))throw new AurayError("native_checkpoint_mismatch");
  if(!currentFree(report,now) || !report.financially_eligible || !report.account_id || !report.key_id ||
    report.contract_sha256!==profile.contract_sha256 || Math.min(report.plan_remaining!,report.key_remaining!)<needed)throw new AurayError("complete_chapter_budget_required");
  const fingerprint=await nativeFingerprint(draft,context,profile);
  const tasks=Array.from({length:count},(_,i)=>{
    const shot=aurayAuditionSchema.parse(nativeShot(draft,context,profile,input.episode_id,fingerprint,i)),key=aurayAuditionKey(shot,report);
    const reused=reuse.find(r=>r.index===i);
    return {request_key:key,job_id:`video_${key}`,phase:reused?"ready" as const:"planned" as const,charged_credits:0,settled:!!reused,
      clip:reused?{...reused.clip,request_key:key,path:`episodes/${input.episode_id}/native/${reused.clip.sha256}.mp4`}:null,error_code:null,...(reused?{reused}:{})};
  });
  return nativeRunSchema.parse({version:1,episode_id:input.episode_id,profile,context,draft,fingerprint,reserved_at:new Date(now).toISOString(),account_id:report.account_id,key_id:report.key_id,
    period:report.period,contract_sha256:report.contract_sha256,initial_plan_remaining:report.plan_remaining,initial_key_remaining:report.key_remaining,
    reserved_credits:needed,tasks,revision:0,output:null,budget_reconciled:false});
}
export async function validateNativeRun(raw:unknown):Promise<NativeRun> {
  const run=nativeRunSchema.parse(raw);
  const count=nativeShotCount(run.context),reused=run.tasks.filter(t=>t.reused);
  if((reused.length!==0&&reused.length!==count-1) || run.tasks.length!==count || run.reserved_credits!==(count-reused.length)*5 || Math.min(run.initial_plan_remaining,run.initial_key_remaining)<run.reserved_credits)throw new AurayError("native_checkpoint_mismatch");
  if(await nativeFingerprint(run.draft,run.context,run.profile)!==run.fingerprint || run.contract_sha256!==run.profile.contract_sha256)throw new AurayError("native_checkpoint_mismatch");
  let unfinished=false;
  for(const [i,t] of run.tasks.entries()) {
    const expected=aurayAuditionKey(aurayAuditionSchema.parse(nativeShot(run.draft,run.context,run.profile,run.episode_id,run.fingerprint,i)),
      {account_id:run.account_id,period:run.period,contract_sha256:run.contract_sha256} as AurayInspection);
    if(t.request_key!==expected || t.job_id!==`video_${expected}` || (t.phase==="ready")!==Boolean(t.clip) ||
      (t.phase==="ready" && (!t.settled || unfinished&&!t.reused)) || (unfinished && t.phase!=="planned"&&!t.reused) ||
      (t.phase==="planned" && (t.settled || t.charged_credits!==0)) || (t.clip && (t.clip.request_key!==expected || t.clip.path!==`episodes/${run.episode_id}/native/${t.clip.sha256}.mp4`)))
      throw new AurayError("native_checkpoint_mismatch");
    if(t.reused && (t.reused.index!==i || t.reused.episode_id===run.episode_id || t.reused.clip.path!==`episodes/${t.reused.episode_id}/native/${t.reused.clip.sha256}.mp4` ||
      t.phase!=="ready" || t.charged_credits!==0 || !t.settled || t.clip?.sha256!==t.reused.clip.sha256 || t.clip?.frames!==t.reused.clip.frames))throw new AurayError("native_checkpoint_mismatch");
    if(t.rate_limit_retries && t.phase==="planned")throw new AurayError("native_checkpoint_mismatch");
    if(t.phase!=="ready")unfinished=true;
  }
  if((run.output || run.budget_reconciled) && run.tasks.some(t=>t.phase!=="ready") || run.budget_reconciled && !run.output)throw new AurayError("native_checkpoint_mismatch");
  if(run.output) {
    const base=`episodes/${run.episode_id}/native/`;
    if(run.output.path!==`${base}${run.output.sha256}.mp4` || run.output.script_path!==`${base}${run.output.script_sha256}.json` || run.output.qa_path!==`${base}${run.output.qa_sha256}.json`)throw new AurayError("native_checkpoint_mismatch");
  }
  return run;
}
export interface NativeChapterDependencies {
  provider:Pick<AurayVideoProvider,"inspect"|"upload"|"submit"|"status">;
  /** Must recheck the shared account lease immediately before a mutation. */
  guard(submission?:boolean):Promise<void>;
  /** Atomic compare-and-swap: next.revision must be the stored revision + 1. */
  save(next:NativeRun):Promise<void>;
  reference(path:string,sha256:string):Promise<Uint8Array>;
  verifyReuse?(run:NativeRun):Promise<void>;
  collect(job:string,shot:ReturnType<typeof aurayAuditionSchema.parse>):Promise<NativeClip>;
  assemble(run:NativeRun):Promise<NonNullable<NativeRun["output"]>>;
  now?():number;
}
export type NativeStep={code:"submitted"|"waiting"|"collected"|"review_pending"|"blocked";poll_after_seconds:number;error_code?:string;budget_reconciled?:boolean};

/** Exactly one bounded task step. Calling again reads the saved job, never POSTs it twice. */
export async function advanceNativeChapter(raw:unknown,deps:NativeChapterDependencies):Promise<NativeStep> {
  const run=await validateNativeRun(raw),clock=()=>deps.now?.()??Date.now();
  await deps.guard();
  async function save() {run.revision++;await validateNativeRun(run);await deps.save(structuredClone(run));}
  if(run.not_before && Date.parse(run.not_before)>clock())return {code:"waiting",poll_after_seconds:Math.ceil((Date.parse(run.not_before)-clock())/1000)};
  const index=run.tasks.findIndex(t=>t.phase!=="ready");
  if(index<0) {
    if(!run.output) {run.output=await deps.assemble(run);await save();}
    if(!run.budget_reconciled) {
      let r:AurayInspection;
      try{r=await deps.provider.inspect();}catch{return {code:"review_pending",poll_after_seconds:60,budget_reconciled:false};}
      const charged=run.tasks.reduce((n,t)=>n+t.charged_credits,0);
      if(!currentFree(r,clock()) || r.account_id!==run.account_id || r.key_id!==run.key_id)return {code:"review_pending",poll_after_seconds:60,budget_reconciled:false};
      // Remain reserved while billing is delayed. A new month cannot submit any
      // remaining shot: all takes are already immutable, settled and downloaded.
      if(r.period!==run.period || (r.plan_remaining!<=run.initial_plan_remaining-charged && r.key_remaining!<=run.initial_key_remaining-charged)) {
        run.budget_reconciled=true;await save();
      }
    }
    return {code:"review_pending",poll_after_seconds:run.budget_reconciled?0:60,budget_reconciled:run.budget_reconciled};
  }
  const task=run.tasks[index]!,shot=aurayAuditionSchema.parse(nativeShot(run.draft,run.context,run.profile,run.episode_id,run.fingerprint,index));
  if(task.phase==="failed")return {code:"blocked",poll_after_seconds:0,error_code:"native_job_failed_no_retry"};
  // Only an explicit HTTP 429 with no acceptance may be retried once. Unknown
  // POST outcomes always stay read-only, even when the status endpoint says 404.
  const retryRateLimit=task.phase==="rejected" && task.error_code==="rate_limited" && !task.rate_limit_retries && task.charged_credits===0 && !task.settled;
  if(task.phase==="rejected" && !retryRateLimit)return {code:"blocked",poll_after_seconds:0,error_code:task.error_code??"native_submission_rejected"};
  if(task.phase==="planned" || retryRateLimit) {
    if(run.tasks.some(t=>t.reused)) {
      if(!deps.verifyReuse)throw new AurayError("native_reuse_unverified");
      await deps.verifyReuse(run);
    }
    const report=await deps.provider.inspect(),needed=run.tasks.filter(t=>t.phase==="planned" || t===task).length*5;
    if(!currentFree(report,clock()) || !report.financially_eligible || report.account_id!==run.account_id || report.key_id!==run.key_id ||
      report.period!==run.period || report.contract_sha256!==run.contract_sha256 || Math.min(report.plan_remaining!,report.key_remaining!)<needed)
      return {code:"blocked",poll_after_seconds:60,error_code:"native_financial_gate_closed"};
    const image=await deps.reference(shot.reference_path,shot.reference_sha256);
    await deps.guard(true);const path=await deps.provider.upload(image,task.request_key,run.account_id);
    // The retry intent is durable before POST; a crash cannot repeat the retry.
    if(retryRateLimit){task.rate_limit_retries=1;task.phase="submission_unknown";}
    else task.phase="submission_started";
    await save(); // Durable identity BEFORE a possibly accepted POST.
    await deps.guard(true);
    try {
      const accepted=await deps.provider.submit(shot,path,task.request_key,report,{allowNativeDialogueProbe:true,allowNativeChapter:true});
      if(accepted!==task.job_id)throw new AurayError("job_unverified","unknown");
    } catch(error) {
      task.phase=error instanceof AurayError && error.acceptance==="none"?"rejected":"submission_unknown";
      task.error_code=error instanceof AurayError && /^[a-z_]{1,80}$/.test(error.code)?error.code:"submission_unknown";
      const recoverable=task.phase==="rejected" && task.error_code==="rate_limited" && !task.rate_limit_retries;
      const delay=Math.max(60,error instanceof AurayError?error.retry_after_seconds??0:0);
      if(recoverable || error instanceof AurayError&&error.retry_after_seconds)run.not_before=new Date(clock()+Math.min(delay,86400000)*1000).toISOString();
      await save();return {code:recoverable?"waiting":"blocked",poll_after_seconds:delay,error_code:task.error_code};
    }
    // A lost persistence response must NOT be caught as a provider rejection.
    task.phase="submitted";task.error_code=null;run.not_before=null;await save();return {code:"submitted",poll_after_seconds:30};
  }
  let remote;
  try {remote=await deps.provider.status(task.job_id);}
  catch(error) {
    // Even 404 after an interrupted POST cannot authorize another submission.
    const delay=Math.max(60,error instanceof AurayError?error.retry_after_seconds??0:0);
    run.not_before=new Date(clock()+Math.min(delay,86400000)*1000).toISOString();await save();
    return {code:"waiting",poll_after_seconds:delay,error_code:error instanceof AurayError?error.code:"native_status_unavailable"};
  }
  if(remote.id!==task.job_id || remote.job_id!==task.job_id || remote.upstream_lost || remote.credits_charged<task.charged_credits ||
    (task.settled && !remote.settled))throw new AurayError("job_unverified");
  task.charged_credits=remote.credits_charged;task.settled=remote.settled;
  task.phase=["failed","cancelled"].includes(remote.status)?"failed":"waiting";
  const delay=Math.max(15,remote.poll_after_seconds);
  run.not_before=remote.status==="succeeded"&&remote.settled || task.phase==="failed"?null:new Date(clock()+Math.min(delay,86400000)*1000).toISOString();
  await save(); // Reconcile the charge before downloading a potentially large file.
  if(task.phase==="failed")return {code:"blocked",poll_after_seconds:0,error_code:"native_job_failed_no_retry"};
  if(remote.status!=="succeeded" || !remote.settled)return {code:"waiting",poll_after_seconds:delay};
  await deps.guard();task.clip=nativeClipSchema.parse(await deps.collect(task.job_id,shot));task.phase="ready";await save();
  return {code:"collected",poll_after_seconds:0};
}
