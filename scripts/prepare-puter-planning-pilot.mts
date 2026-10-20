import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {z} from "zod";
import {prepareNativeDraft,nativeFingerprint} from "../packages/core/src/stories/native-chapter.ts";
import {puterProfileSchema} from "../packages/core/src/stories/native-contract.ts";
import {canonicalStringify,sha256Hex} from "../packages/core/src/validators/hash-utils.ts";

async function main() {
 const plan=z.object({series_id:z.string().uuid(),request_id:z.string().uuid(),presentation_revision:z.number().int().positive(),style_id:z.enum(["cinematic_3d","cartoon_2d","anime","realistic"]),draft:z.unknown()}).strict()
  .parse(JSON.parse(await readFile(resolve(process.argv[2]||"docs/stories/puter-planning-pilot.json"),"utf8")));
 const origin=new URL(process.env.SUPABASE_URL||""),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key||origin.protocol!=="https:"||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)||origin.username||origin.password||origin.port||origin.pathname!=="/")throw Error("invalid_studio_connection");
 async function request(path:string,payload?:Record<string,unknown>) {
  const response=await fetch(origin.origin+"/rest/v1/"+path,{method:payload?"POST":"GET",headers:{apikey:key!,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
   body:payload?JSON.stringify(payload):undefined,redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error("studio_request_failed");return response.json();
 }
 const rows=await request(`studio_series?id=eq.${plan.series_id}&archived_at=is.null&select=workspace_id,bible,editorial_revision,editorial_memory,editorial_guidance`);
 if(rows.length!==1)throw Error("series_unavailable");
 const series=rows[0],members=await request(`studio_members?workspace_id=eq.${series.workspace_id}&role=eq.owner&select=user_id&order=created_at&limit=1`);
 if(members.length!==1)throw Error("workspace_owner_unavailable");
 const args={p_workspace:series.workspace_id,p_actor:members[0].user_id};
 const view=await request("rpc/studio_story_pattern_view",{...args,p_series:plan.series_id,p_revision:plan.presentation_revision,p_style:plan.style_id});
 if(view.source!=="puter"||view.voice_policy!=="approved_variants"||canonicalStringify(view.bible)!==canonicalStringify(series.bible))throw Error("approved_pattern_changed");
 const profile=puterProfileSchema.parse(view.profile);
 for(const reference of profile.references) {
  if(!reference.path.startsWith(series.workspace_id+"/")||!/^[a-zA-Z0-9_./-]+$/.test(reference.path)||reference.path.includes(".."))throw Error("reference_scope_invalid");
  const response=await fetch(origin.origin+"/storage/v1/object/studio-private/"+reference.path,{headers:{apikey:key,Authorization:`Bearer ${key}`},redirect:"error",signal:AbortSignal.timeout(30000)});
  if(!response.ok||Number(response.headers.get("content-length"))>12582912)throw Error("reference_unavailable");
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>12582912||createHash("sha256").update(bytes).digest("hex")!==reference.sha256)throw Error("reference_hash_mismatch");
 }
 const chapters=await request(`studio_story_chapters?series_id=eq.${plan.series_id}&chapter_number=eq.1&select=idea_id`);
 let context:unknown={series_id:plan.series_id,bible:series.bible,chapter_number:1,previous_summaries:[],...(series.editorial_revision>0?{
  editorial:{revision:series.editorial_revision,memory:series.editorial_memory,guidance:series.editorial_guidance}}:{})};
 let existingEpisode:string|undefined;
 if(chapters.length) {
  const ideas=await request(`idea_queue?id=eq.${chapters[0].idea_id}&workspace_id=eq.${series.workspace_id}&select=episode_id`);
  if(ideas[0]?.episode_id){existingEpisode=ideas[0].episode_id;context=(await request(`episodes?id=eq.${existingEpisode}&workspace_id=eq.${series.workspace_id}&select=briefing`))[0].briefing.story_context;}
 }
 const draft=prepareNativeDraft(plan.draft,context,profile),profileHash=await sha256Hex(canonicalStringify(profile));
 const fingerprint=await nativeFingerprint(draft,context,profile);
 const summary={title:draft.title,planning_only:true,execution_allowed:false,seconds:15,dialogue:draft.scenes.map(scene=>({speaker:scene.visual.speaker_id,text:scene.narration_text}))};
 const revise=process.argv.includes("--revise");
 if(!process.argv.includes("--apply")&&!revise){console.log(JSON.stringify({code:"preview",...summary}));return;}
 let result;
 if(revise) {
  const snapshot=await request("rpc/studio_puter_queue_snapshot",args),entry=snapshot.entries.find((item:{id:string})=>item.id===existingEpisode);
  if(!existingEpisode||!entry?.planning_only||entry.state!=="pending")throw Error("planning_pilot_revision_unavailable");
  result=await request("rpc/studio_puter_pilot_revise",{...args,p_episode:existingEpisode,p_revision:entry.revision,p_profile:profileHash,p_fingerprint:fingerprint,p_draft:draft});
 }else result=await request("rpc/studio_puter_pilot_prepare",{...args,p_request:plan.request_id,p_series:plan.series_id,p_revision:plan.presentation_revision,p_style:plan.style_id,
  p_profile:profileHash,p_fingerprint:fingerprint,p_draft:draft});
 if(!["prepared","existing","revised"].includes(result.code)||result.planning_only!==true)throw Error("pilot_preparation_refused");
 const snapshot=await request("rpc/studio_puter_queue_snapshot",args),entry=snapshot.entries.find((item:{id:string})=>item.id===result.episode_id);
 if(!entry?.planning_only||entry.state!=="pending")throw Error("pilot_planning_state_mismatch");
 const saved=(await request(`studio_puter_preparations?episode_id=eq.${result.episode_id}&select=draft,fingerprint`))[0];
 const savedContext=(await request(`episodes?id=eq.${result.episode_id}&select=briefing`))[0].briefing.story_context;
 if(await nativeFingerprint(saved.draft,savedContext,profile)!==saved.fingerprint)throw Error("pilot_fingerprint_mismatch");
 if((await request(`studio_puter_runs?episode_id=eq.${result.episode_id}&select=episode_id`)).length||
  (await request(`studio_video_jobs?episode_id=eq.${result.episode_id}&select=id`)).length)throw Error("unexpected_pilot_work");
 if((await request("rpc/puter_worker_input",{p_episode:result.episode_id})).code!=="native_setup_required")throw Error("pilot_execution_not_blocked");
 console.log(JSON.stringify({code:result.code,episode_id:result.episode_id,...summary}));
}
main().catch(()=>{console.error("puter_planning_pilot_failed_no_generation_attempted");process.exitCode=1;});