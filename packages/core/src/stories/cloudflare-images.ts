import {z} from "zod";
export const cloudflareImageConnectionSchema=z.object({account_id:z.string().regex(/^[a-f0-9]{32}$/),token:z.string().regex(/^[A-Za-z0-9_-]{30,200}$/)}).strict();
export const CLOUDFLARE_IMAGE_MODEL="@cf/black-forest-labs/flux-1-schnell";
type Credentials=z.infer<typeof cloudflareImageConnectionSchema>;
export class ReferenceProviderError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
async function boundedJson(response:Response,maximum:number){
 const reader=response.body?.getReader();if(!reader)throw new ReferenceProviderError("invalid_response");let n=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>maximum){await reader.cancel();throw new ReferenceProviderError("response_too_large");}chunks.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function inspectCloudflareImages(raw:unknown,fetcher:typeof fetch=fetch) {
 const c=cloudflareImageConnectionSchema.parse(raw),headers={Authorization:`Bearer ${c.token}`};
 const base=`https://api.cloudflare.com/client/v4/accounts/${c.account_id}`;
 const sub=await fetcher(`${base}/subscriptions`,{headers,redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!sub.ok)throw new ReferenceProviderError("billing_permission_required");
 const j=await boundedJson(sub,128000);
 // Empty subscriptions denote the implicit free account. Unknown and paid subscriptions fail closed.
 if(j.success!==true || !Array.isArray(j.result) || j.result_info?.total_count>j.result.length)throw new ReferenceProviderError("free_plan_unverified");
 if(j.result.some((s:{state?:string;rate_plan?:{price?:number;id?:string}})=>s.state!=="expired" && (s.rate_plan?.price!==0 || !/free/i.test(s.rate_plan?.id??"") || /paid|standard|bundled|unbound|pro|enterprise/i.test(s.rate_plan?.id??""))))throw new ReferenceProviderError("free_plan_required");
 const models=await fetcher(`${base}/ai/models/search?search=flux-1-schnell`,{headers,redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!models.ok)throw new ReferenceProviderError("ai_permission_required");
 const list=await boundedJson(models,256000);
 if(list.success!==true || !Array.isArray(list.result) || !list.result.some((m:{name?:string})=>m.name===CLOUDFLARE_IMAGE_MODEL))throw new ReferenceProviderError("image_model_unavailable");
 return {plan:"workers_free" as const,model:CLOUDFLARE_IMAGE_MODEL,checked_at:new Date().toISOString(),daily_neurons:10000,remaining_neurons:null};
}
export async function generateCloudflareReference(raw:unknown,prompt:string,fetcher:typeof fetch=fetch):Promise<Uint8Array> {
 const c:Credentials=cloudflareImageConnectionSchema.parse(raw);
 if(prompt.length<40||prompt.length>2048)throw new ReferenceProviderError("invalid_prompt");
 await inspectCloudflareImages(c,fetcher);
 const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${c.account_id}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`,{
  method:"POST",headers:{Authorization:`Bearer ${c.token}`,"Content-Type":"application/json"},body:JSON.stringify({prompt,steps:8}),redirect:"error",signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw new ReferenceProviderError([429,3040].includes(response.status)?"daily_quota_or_capacity":"image_generation_failed");
 const j=await boundedJson(response,18*1024*1024),base64=j.result?.image;
 if(j.success!==true || typeof base64!=="string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new ReferenceProviderError("invalid_image_response");
 const binary=atob(base64);return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
