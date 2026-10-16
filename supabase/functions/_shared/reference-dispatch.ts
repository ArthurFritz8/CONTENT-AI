import {z} from "zod";
import type {createServiceClient} from "./supabase-client.ts";
import {dispatchGithub} from "./github-dispatch.ts";
/** Recover only image requests explicitly admitted by a member; no periodic idle Actions. */
export async function dispatchPendingReferences(db:ReturnType<typeof createServiceClient>) {
 const {data,error}=await db.rpc("reference_recovery_jobs");if(error)return null;
 const jobs=z.array(z.string().uuid()).max(3).parse(data);
 if(!jobs.length)return null;
 for(const job of jobs)await dispatchGithub("story-references.yml",job);
 return {reference_requests_dispatched:jobs.length};
}
