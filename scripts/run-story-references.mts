/** Only DB-admitted reference requests; never accepts arbitrary CLI prompts or tokens. */
import {createHash,randomUUID} from "node:crypto";
import sharp from "sharp";
import {generateCloudflareReference,ReferenceProviderError} from "../packages/core/src/stories/cloudflare-images.ts";
import {z} from "zod";
const id=z.string().uuid(),hash=(b:Uint8Array|string)=>createHash("sha256").update(b).digest("hex");
async function main(){
 if(process.env.GITHUB_ACTIONS!=="true")throw Error("cloud_runner_required");
 const origin=new URL(process.env.SUPABASE_URL||""),service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(origin.protocol!=="https:"||!/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname)||origin.username||origin.password||origin.port||!service)throw Error("invalid_configuration");
 const headers={apikey:service,Authorization:`Bearer ${service}`};
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await fetch(`${origin.origin}/rest/v1/rpc/${name}`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(25000),redirect:"error"});if(!r.ok)throw Error("reference_database_unavailable");const raw=await r.text();return raw?JSON.parse(raw):null;};
 const jobs=process.env.REFERENCE_JOB_ID?[id.parse(process.env.REFERENCE_JOB_ID)]:z.array(id).max(3).parse(await rpc("reference_recovery_jobs",{}));
 for(const job of jobs){
  const token=randomUUID(),v=await rpc("claim_reference_job",{p_id:job,p_token:token});
  if(v.code!=="claimed"){process.stdout.write(JSON.stringify({job_id:job,code:v.code})+"\n");continue;}
  try{
   const c=v.input.character,styles:Record<string,string>={cinematic_3d:"High quality cinematic 3D animated film character",cartoon_2d:"Clean expressive 2D cartoon character",anime:"Detailed expressive anime character",realistic:"Photorealistic character portrait",motion_comic:"Detailed comic book character",illustrated:"Original storybook illustration"};
   const prompt=`${styles[v.input.style_id]||styles.cinematic_3d}. Original adult character, ${c.appearance}, ${c.color}. ${c.appearance_description||c.personality}. Full character centered, entire hair, face, clothing, arms and hands visible. Sharp expressive eyes, stable detailed anatomy, simple natural pose, soft neutral studio background, no text, no logos, no additional characters. Character identity: ${c.name}. Setting context: ${String(v.input.world??"").slice(0,300)}`.slice(0,2048);
   const raw=await generateCloudflareReference(v.credential,prompt);
   const image=await sharp(raw,{limitInputPixels:16000000,failOn:"warning"}).autoOrient().flatten({background:"#eeeeea"}).resize(768,1344,{fit:"contain",background:"#eeeeea"}).png().toBuffer();
   const sha=hash(image),args={p_workspace:v.workspace,p_actor:v.actor};
   const media=await rpc("studio_production_media_reserve",{...args,p_series:v.series,p_id:job,p_character:v.character,p_kind:"reference",p_sha:sha,p_bytes:image.length,p_metadata:{mime:"image/png",width:768,height:1344}});
   if(!media.ready){
    if(!media.path.startsWith(`${v.workspace}/story-profile/${v.series}/`)||media.path.includes(".."))throw Error("reference_scope_invalid");
    const url=`${origin.origin}/storage/v1/object/studio-private/${media.path}`;
    const uploaded=await fetch(url,{method:"POST",headers:{...headers,"Content-Type":"image/png","x-upsert":"false"},body:new Uint8Array(image),signal:AbortSignal.timeout(20000),redirect:"error"}).catch(()=>null);
    if(!uploaded?.ok){const check=await fetch(url,{headers,signal:AbortSignal.timeout(15000),redirect:"error"});if(!check.ok||Number(check.headers.get("content-length"))>12000000||hash(new Uint8Array(await check.arrayBuffer()))!==sha)throw Error("reference_storage_unresolved");}
    await rpc("studio_production_media_ready",{...args,p_id:job,p_sha:sha});
   }
   await rpc("finish_reference_job",{p_id:job,p_token:token,p_code:"ready",p_media:job});
   process.stdout.write(JSON.stringify({job_id:job,code:"ready",sha256:sha})+"\n");
  }catch(e){const code=e instanceof ReferenceProviderError?e.code:"reference_execution_interrupted";await rpc("finish_reference_job",{p_id:job,p_token:token,p_code:code,p_media:null}).catch(()=>{});process.stdout.write(JSON.stringify({job_id:job,code})+"\n");}
 }
}
main().catch(()=>{process.stderr.write("Reference worker interrupted; saved requests were preserved.\n");process.exitCode=1;});
