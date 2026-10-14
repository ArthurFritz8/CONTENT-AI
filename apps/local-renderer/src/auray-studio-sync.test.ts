import {test} from "node:test";
import {strictEqual,deepStrictEqual,rejects} from "node:assert";
import {randomUUID} from "node:crypto";
import {aurayAccountFingerprint,aurayMonitorObservation,syncAurayMonitor,aurayStudioRpcResult,type MonitoredAurayJob} from "./auray-studio-sync.ts";
import {AURAY,missingAurayKey,type AurayJob} from "./auray-video-provider.ts";
const account=randomUUID(),wallet=randomUUID(),token=randomUUID(),fingerprint=aurayAccountFingerprint(account);
const report=()=>({...missingAurayKey(),account_id:account,period:new Date().toISOString().slice(0,7),monthly_allowance:50,plan_remaining:0,key_remaining:0,blockers:["insufficient_free_credits"]});
const job=():MonitoredAurayJob=>({id:randomUUID(),external_id:`video_${"1".repeat(64)}`,kind:"native_dialogue_probe",aspect_ratio:"9:16",ready:false,status:"unknown",settled:false,expected_sha256:"2".repeat(64),output_sha256:null,bytes:null,path:null});
const remote=(j:MonitoredAurayJob):AurayJob=>({id:j.external_id,job_id:j.external_id,object:"job",product:"video",model:AURAY.model,status:"succeeded",settled:true,credits_charged:5,poll_after_seconds:30,created_at:new Date().toISOString()});
test("SQL void RPCs return 204; malformed and oversized replies never expose raw server prose",async()=>{
  strictEqual(await aurayStudioRpcResult(new Response(null,{status:204})),null);
  deepStrictEqual(await aurayStudioRpcResult(Response.json({code:"claimed"})),{code:"claimed"});
  await rejects(aurayStudioRpcResult(new Response("private server details",{status:403})),/^AurayError: studio_rpc_failed$/);
  await rejects(aurayStudioRpcResult(new Response("invalid json")),/^AurayError: studio_rpc_invalid_response$/);
  await rejects(aurayStudioRpcResult(new Response("x".repeat(4*1024*1024+1))),/^AurayError: studio_rpc_invalid_response$/);
});
test("exhausted free balance is truthful; mixed funds become unknown and account replacement is rejected",async()=>{
  strictEqual(aurayMonitorObservation(report(),fingerprint).plan_remaining,0);
  const mixed={...report(),plan_remaining:900,blockers:["mixed_or_promotional_wallet"]};
  strictEqual(aurayMonitorObservation(mixed,fingerprint).plan_remaining,null);
  await rejects(async()=>aurayMonitorObservation({...report(),account_id:randomUUID()},fingerprint),/account_mismatch/);
});
test("cloud recovery collects exactly the registered job even at zero credits; repeat skips stored output",async()=>{
  const j=job(),operations:string[]=[],records:unknown[]=[];
  const deps={inspect:async()=>{operations.push("inspect");return report();},status:async(id:string)=>{strictEqual(id,j.external_id);operations.push("get-job");return remote(j);},
    collect:async()=>{operations.push("collect");return {output_sha256:j.expected_sha256!,bytes:100};},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      operations.push(name);
      if(name==="claim_auray_sync")return {code:"claimed",account_sha256:fingerprint,jobs:[j]};
      if(name==="record_auray_job"){records.push(args.p_result);if((args.p_result as {output_sha256?:string}).output_sha256)j.ready=true;}
      return null;
    }};
  strictEqual((await syncAurayMonitor(wallet,token,deps)).code,"synced");
  strictEqual(records.length,2);strictEqual((records[0] as AurayJob).status,"succeeded");
  operations.length=0;await syncAurayMonitor(wallet,token,deps);
  strictEqual(operations.includes("collect"),false);strictEqual(operations.includes("get-job"),false);
});
test("download interruption preserves accepted status and same ID on retry; never has a submit dependency",async()=>{
  const j=job(),ids:string[]=[],finished:boolean[]=[],saved:unknown[]=[];let failed=true;
  const deps={inspect:async()=>report(),status:async(id:string)=>{ids.push(id);return remote(j);},
    collect:async()=>{if(failed)throw Error("interrupted");return {output_sha256:j.expected_sha256!,bytes:100};},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      if(name==="claim_auray_sync")return {code:"claimed",account_sha256:fingerprint,jobs:[j]};
      if(name==="record_auray_job")saved.push(args.p_result);
      if(name==="finish_auray_sync")finished.push(args.p_success as boolean);
      return null;
    }};
  await rejects(syncAurayMonitor(wallet,token,deps),/interrupted/);strictEqual(saved.length,1);
  failed=false;await syncAurayMonitor(wallet,token,deps);deepStrictEqual(ids,[j.external_id,j.external_id]);deepStrictEqual(finished,[false,true]);
});
test("busy lease, account change and different output bytes cannot publish a ready record",async()=>{
  let mode="busy",collected=0;const ready:unknown[]=[],j=job();
  const deps={inspect:async()=>({...report(),account_id:mode==="account" ? randomUUID() : account}),status:async()=>remote(j),
    collect:async()=>{collected++;return {output_sha256:"3".repeat(64),bytes:100};},
    rpc:async(name:string,args:Record<string,unknown>)=>{
      if(name==="claim_auray_sync")return mode==="busy" ? {code:"waiting"} : {code:"claimed",account_sha256:fingerprint,jobs:[j]};
      if(name==="record_auray_job" && (args.p_result as {output_sha256?:string}).output_sha256)ready.push(args);return null;
    }};
  strictEqual((await syncAurayMonitor(wallet,token,deps)).code,"waiting");strictEqual(collected,0);
  mode="account";await rejects(syncAurayMonitor(wallet,token,deps),/account_mismatch/);strictEqual(collected,0);
  mode="hash";await rejects(syncAurayMonitor(wallet,token,deps),/asset_unverified/);strictEqual(ready.length,0);
});
