/** Durable Puter chapter: every accepted/uncertain attempt is recovered by its one private filename. */
import {z} from "zod";
import {createHash} from "node:crypto";
import {puterProfileSchema,nativeDraftSchema} from "../../../packages/core/src/stories/native-contract.ts";
import {storyContextSchema,nativeShotCount} from "../../../packages/core/src/stories/schema.ts";
import {NATIVE_PUTER} from "../../../packages/core/src/stories/puter-contract.ts";
import {nativeFingerprint,nativeShot,validateNativeDraft} from "../../../packages/core/src/stories/native-chapter.ts";
import {PuterError,puterCurrentFree,puterRequestKey,puterFilename,puterShotSchema,type PuterInspection,type PuterVideoProvider} from "./puter-video-provider.ts";

const sha=z.string().regex(/^[a-f0-9]{64}$/),hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
export const puterClipSchema=z.object({request_key:sha,sha256:sha,frames:z.number().int().min(148).max(152),path:z.string().max(500)}).strict();
export type PuterClip=z.infer<typeof puterClipSchema>;
const taskSchema=z.object({request_key:sha,remote_filename:z.string().regex(/^content-ai-puter-[a-f0-9]{64}\.mp4$/),
  phase:z.enum(["planned","submission_started","submission_unknown","collecting","ready","failed"]),
  remote_sha256:sha.nullable(),remote_complete:z.boolean(),cleanup_done:z.boolean(),
  clip:puterClipSchema.nullable(),error_code:z.string().regex(/^[a-z_]{1,80}$/).nullable(),
}).strict();
export const puterRunSchema=z.object({version:z.literal(1),provider:z.literal("puter"),episode_id:z.string().uuid(),fingerprint:sha,
  reserved_at:z.string().datetime(),profile:puterProfileSchema,context:storyContextSchema,draft:nativeDraftSchema,
  account_sha256:sha,initial_remaining_credits:z.number().finite().min(990).max(1000),reserved_credits:z.number().int().min(990).max(1000),
  tasks:z.array(taskSchema).min(3).max(9),revision:z.number().int().nonnegative(),
  output:z.object({path:z.string().max(500),sha256:sha,bytes:z.number().int().positive().max(50*1024*1024),
    script_path:z.string().max(500),script_sha256:sha,qa_path:z.string().max(500),qa_sha256:sha}).strict().nullable(),
  budget_reconciled:z.boolean(),
}).strict();
export type PuterRun=z.infer<typeof puterRunSchema>;
export async function createPuterRun(input:{episode_id:string;profile:unknown;context:unknown;draft:unknown},report:PuterInspection,now=Date.now()):Promise<PuterRun> {
  const profile=puterProfileSchema.parse(input.profile),context=storyContextSchema.parse(input.context),draft=validateNativeDraft(input.draft,context,profile);
  const count=nativeShotCount(context),needed=count*NATIVE_PUTER.creditsPerShot;
  if(!puterCurrentFree(report,undefined,now)||report.remaining_credits!<needed||needed>1000)throw new PuterError("complete_chapter_budget_required");
  const fingerprint=await nativeFingerprint(draft,context,profile),tasks=[];
  for(let i=0;i<count;i++) {
    const shot=puterShotSchema.parse(nativeShot(draft,context,profile,input.episode_id,fingerprint,i)),key=await puterRequestKey(shot,report.account_sha256);
    tasks.push({request_key:key,remote_filename:puterFilename(key),phase:"planned",remote_sha256:null,remote_complete:false,cleanup_done:false,clip:null,error_code:null});
  }
  return puterRunSchema.parse({version:1,provider:"puter",episode_id:input.episode_id,fingerprint,reserved_at:new Date(now).toISOString(),profile,context,draft,
    account_sha256:report.account_sha256,initial_remaining_credits:report.remaining_credits,reserved_credits:needed,tasks,revision:0,output:null,budget_reconciled:false});
}
export async function validatePuterRun(raw:unknown):Promise<PuterRun> {
  const run=puterRunSchema.parse(raw),count=nativeShotCount(run.context);
  if(run.tasks.length!==count||run.reserved_credits!==count*NATIVE_PUTER.creditsPerShot||run.initial_remaining_credits<run.reserved_credits||
    await nativeFingerprint(run.draft,run.context,run.profile)!==run.fingerprint)throw new PuterError("native_checkpoint_mismatch");
  let unfinished=false;
  for(const [i,t] of run.tasks.entries()) {
    const key=await puterRequestKey(nativeShot(run.draft,run.context,run.profile,run.episode_id,run.fingerprint,i),run.account_sha256);
    if(t.request_key!==key||t.remote_filename!==puterFilename(key)||(t.phase==="ready")!==!!t.clip||
       t.remote_complete!==!!t.remote_sha256||t.cleanup_done&&(!t.clip||!t.remote_complete)||
       t.clip&&(t.clip.request_key!==key||t.clip.sha256!==t.remote_sha256||t.clip.path!==`episodes/${run.episode_id}/native/${t.clip.sha256}.mp4`)||
       t.phase==="planned"&&(t.remote_complete||t.clip||t.error_code)||
       unfinished&&t.phase!=="planned")throw new PuterError("native_checkpoint_mismatch");
    if(t.phase!=="ready")unfinished=true;
  }
  if((run.output||run.budget_reconciled)&&run.tasks.some(t=>t.phase!=="ready")||run.budget_reconciled&&!run.output)throw new PuterError("native_checkpoint_mismatch");
  if(run.output)for(const [path,digest,ext] of [[run.output.path,run.output.sha256,"mp4"],[run.output.script_path,run.output.script_sha256,"json"],[run.output.qa_path,run.output.qa_sha256,"json"]])
    if(path!==`episodes/${run.episode_id}/native/${digest}.${ext}`)throw new PuterError("native_checkpoint_mismatch");
  return run;
}
export interface PuterChapterDependencies {
  provider:Pick<PuterVideoProvider,"inspect"|"submit"|"download"|"removeVerifiedCopy">;
  guard(submission?:boolean):Promise<void>;
  save(run:PuterRun):Promise<void>;
  reference(path:string,sha256:string):Promise<Uint8Array>;
  /** Reads an already verified Studio object when a collection acknowledgement was lost. */
  cached(path:string,sha256:string):Promise<Uint8Array|null>;
  collect(bytes:Uint8Array,key:string,index:number):Promise<PuterClip>;
  assemble(run:PuterRun):Promise<NonNullable<PuterRun["output"]>>;
  /** Keeps the shared account lease alive during the single synchronous provider POST. */
  duringSubmit<T>(operation:()=>Promise<T>):Promise<T>;
  now?():number;
}
export async function advancePuterChapter(raw:unknown,deps:PuterChapterDependencies):Promise<{code:"submitted"|"waiting"|"collected"|"review_pending"|"blocked";poll_after_seconds:number;error_code?:string}> {
  const run=await validatePuterRun(raw),clock=()=>deps.now?.()??Date.now();await deps.guard();
  const save=async()=>{run.revision++;await validatePuterRun(run);await deps.save(structuredClone(run));};
  // Cleanup only complete originals already durably collected. A changed remote copy is retained.
  for(const t of run.tasks.filter(t=>t.phase==="ready"&&!t.cleanup_done)) {
    const verified=await deps.cached(t.clip!.path,t.clip!.sha256);
    if(!verified||hash(verified)!==t.clip!.sha256)throw new PuterError("verified_copy_unavailable");
    await deps.guard();
    try{await deps.provider.removeVerifiedCopy(t.request_key,run.account_sha256,t.clip!.sha256);t.cleanup_done=true;await save();}
    catch(e){if(e instanceof PuterError&&e.code==="remote_copy_changed_no_cleanup")throw e;return {code:"waiting",poll_after_seconds:120,error_code:"source_cleanup_pending"};}
  }
  const index=run.tasks.findIndex(t=>t.phase!=="ready");
  if(index<0) {
    if(!run.output){run.output=await deps.assemble(run);await save();}
    // Existence of each saved remote file proves the server finished metering BEFORE saving it.
    // No unfinished upstream request remains; fresh inspection gates every subsequent chapter.
    if(!run.budget_reconciled){run.budget_reconciled=true;await save();}
    return {code:"review_pending",poll_after_seconds:0};
  }
  const task=run.tasks[index]!;
  if(task.phase==="failed")return {code:"blocked",poll_after_seconds:0,error_code:task.error_code??"native_media_failed"};
  if(task.phase==="planned") {
    const report=await deps.provider.inspect(),needed=run.tasks.filter(t=>t.phase==="planned").length*NATIVE_PUTER.creditsPerShot;
    if(!puterCurrentFree(report,run.account_sha256,clock())||report.remaining_credits!<needed)return {code:"blocked",poll_after_seconds:120,error_code:"native_financial_gate_closed"};
    const shot=puterShotSchema.parse(nativeShot(run.draft,run.context,run.profile,run.episode_id,run.fingerprint,index));
    const image=await deps.reference(shot.reference_path,shot.reference_sha256);
    if(hash(image)!==shot.reference_sha256)throw new PuterError("reference_changed");
    await deps.guard(true);task.phase="submission_started";await save();
    await deps.guard(true);
    try {const name=await deps.duringSubmit(()=>deps.provider.submit(shot,image,task.request_key,report));
      if(name!==task.remote_filename)throw new PuterError("request_identity_changed","unknown");
    } catch(error) {
      task.phase="submission_unknown";task.error_code=error instanceof PuterError?error.code:"submission_unknown";await save();
      return {code:"waiting",poll_after_seconds:120,error_code:task.error_code};
    }
    task.phase="collecting";await save();return {code:"submitted",poll_after_seconds:0};
  }
  let bytes:Uint8Array|null=null;
  if(task.remote_sha256)bytes=await deps.cached(`episodes/${run.episode_id}/native/${task.remote_sha256}.mp4`,task.remote_sha256);
  if(!bytes) {
    try{bytes=await deps.provider.download(task.request_key,run.account_sha256);}
    catch(e){return {code:"waiting",poll_after_seconds:120,error_code:e instanceof PuterError?e.code:"remote_file_not_ready"};}
  }
  const digest=hash(bytes);
  if(task.remote_sha256&&digest!==task.remote_sha256)throw new PuterError("remote_copy_changed_no_cleanup");
  if(!task.remote_complete){task.remote_sha256=digest;task.remote_complete=true;task.phase="collecting";await save();}
  try {
    task.clip=puterClipSchema.parse(await deps.collect(bytes,task.request_key,index));
    if(task.clip.sha256!==digest)throw new PuterError("cached_output_changed");
  } catch(e) {
    if(e instanceof PuterError&&e.code==="native_media_contract_changed") {task.phase="failed";task.error_code=e.code;await save();}
    throw e;
  }
  task.phase="ready";task.error_code=null;await save();return {code:"collected",poll_after_seconds:0};
}
