/** Read-only provider reconciliation. This module has no submit/upload-to-Auray route. */
import { z } from "zod";
import { aurayHash, AurayError, type AurayInspection, type AurayJob } from "./auray-video-provider.ts";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const monitoredJobSchema = z.object({
  id:z.string().uuid(), external_id:z.string().regex(/^video_[a-f0-9]{64}$/),
  kind:z.enum(["action","reaction","native_dialogue_probe"]), aspect_ratio:z.enum(["9:16","16:9"]), ready:z.boolean(),
  status:z.enum(["unknown","queued","running","succeeded","failed","cancelled"]), settled:z.boolean(),
  expected_sha256:sha.nullable(), output_sha256:sha.nullable(), bytes:z.number().int().positive().nullable(), path:z.string().nullable(),
});
export type MonitoredAurayJob = z.infer<typeof monitoredJobSchema>;
export const aurayAccountFingerprint = (id:string) => aurayHash({provider:"auray",account:z.string().uuid().parse(id)});
export async function readAurayStudioBytes(response:Response,limit:number) {
  const reader=response.body?.getReader();if(!reader)throw new AurayError("storage_unavailable");
  const chunks:Uint8Array[]=[];let total=0;
  try {while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>limit)throw new AurayError("response_too_large");chunks.push(r.value);}}
  catch(e){void reader.cancel().catch(()=>{});throw e;}
  return Buffer.concat(chunks);
}
export async function aurayStudioRpcResult(response:Response):Promise<unknown> {
  if(!response.ok)throw new AurayError("studio_rpc_failed");
  // PostgREST returns 204 without a body for SQL functions returning void.
  if(response.status===204)return null;
  try {const bytes=await readAurayStudioBytes(response,4*1024*1024);return bytes.length ? JSON.parse(bytes.toString("utf8")) : null;}
  catch {throw new AurayError("studio_rpc_invalid_response");}
}
export function aurayMonitorObservation(report:AurayInspection, expectedAccount:string) {
  if (!report.account_id || aurayAccountFingerprint(report.account_id)!==expectedAccount) throw new AurayError("account_mismatch");
  // Insufficient credits do not prevent a truthful zero balance or recovery of an old job.
  const trustworthy = report.blockers.every(b=>b==="insufficient_free_credits");
  return { checked_at:report.checked_at,period:report.period,monthly_allowance:report.monthly_allowance,
    plan_remaining:trustworthy ? report.plan_remaining : null,key_remaining:trustworthy ? report.key_remaining : null,
    blockers:report.blockers,production_ready:false };
}
export interface AurayMonitorDependencies {
  inspect():Promise<AurayInspection>;
  status(id:string):Promise<AurayJob>;
  collect(job:MonitoredAurayJob):Promise<{output_sha256:string;bytes:number}>;
  rpc(name:string,args:Record<string,unknown>):Promise<unknown>;
}
export async function syncAurayMonitor(wallet:string, token:string, deps:AurayMonitorDependencies) {
  z.string().uuid().parse(wallet);z.string().uuid().parse(token);
  const base={p_wallet:wallet,p_token:token};
  const raw=await deps.rpc("claim_auray_sync",base);
  const claim=z.discriminatedUnion("code",[
    z.object({code:z.literal("waiting")}),
    z.object({code:z.literal("claimed"),account_sha256:sha,jobs:z.array(monitoredJobSchema).max(50)}),
  ]).parse(raw);
  if(claim.code==="waiting")return {code:"waiting",production_ready:false};
  let success=false, collected=0, checked=0;
  try {
    const report=await deps.inspect();
    await deps.rpc("observe_auray_monitor",{...base,p_observation:aurayMonitorObservation(report,claim.account_sha256)});
    for(const job of claim.jobs) {
      if(job.ready || (job.settled && ["failed","cancelled"].includes(job.status)))continue;
      const remote=await deps.status(job.external_id);checked++;
      if(remote.id!==job.external_id || remote.job_id!==job.external_id || remote.upstream_lost) throw new AurayError("job_unverified");
      const result={external_id:remote.id,status:remote.status,settled:remote.settled,charged_credits:remote.credits_charged};
      // Save financial/status reconciliation before a potentially interrupted asset download.
      await deps.rpc("record_auray_job",{...base,p_job:job.id,p_result:result});
      if(remote.status==="succeeded" && remote.settled) {
        const media=await deps.collect(job);
        if(!sha.safeParse(media.output_sha256).success || (job.expected_sha256 && job.expected_sha256!==media.output_sha256) ||
          !Number.isSafeInteger(media.bytes) || media.bytes<=0 || media.bytes>64*1024*1024)throw new AurayError("asset_unverified");
        await deps.rpc("record_auray_job",{...base,p_job:job.id,p_result:{...result,...media}});collected++;
      }
    }
    success=true;return {code:"synced",checked_jobs:checked,collected_jobs:collected,production_ready:false};
  } finally {
    await deps.rpc("finish_auray_sync",{...base,p_success:success});
  }
}
