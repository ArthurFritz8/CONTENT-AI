/** Native Puter API only. No subscription, top-up, card fallback, vendor URL fetch or POST retry. */
import {z} from "zod";
import {createHash} from "node:crypto";
import {NATIVE_PUTER} from "../../../packages/core/src/stories/puter-contract.ts";
import {canonicalStringify,sha256Hex} from "../../../packages/core/src/validators/hash-utils.ts";

const origin="https://api.puter.com",sha=z.string().regex(/^[a-f0-9]{64}$/);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const money=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
export class PuterError extends Error {
  code:string;acceptance:"none"|"unknown";
  constructor(code:string,acceptance:"none"|"unknown"="none"){super(code);this.code=code;this.acceptance=acceptance;}
}
export const puterInspectionSchema=z.object({provider:z.literal("puter"),account_sha256:sha,checked_at:z.string().datetime(),
  remaining_credits:z.number().finite().nonnegative().nullable(),monthly_allowance:z.literal(1000).nullable(),
  storage_free_bytes:z.number().int().nonnegative().nullable(),
  unit:z.literal("credits"),financially_eligible:z.boolean(),contract_sha256:sha.nullable(),
  budget_basis:z.literal(NATIVE_PUTER.budgetBasis),provider_quote:z.literal(false),
  blockers:z.array(z.string().regex(/^[a-z_]{1,80}$/)).max(12),
}).strict();
export type PuterInspection=z.infer<typeof puterInspectionSchema>;
export const puterShotSchema=z.object({version:z.literal("1.0"),kind:z.literal("native_dialogue_probe"),prompt:z.string().min(40).max(3000),
  reference_path:z.string().min(1).max(500),reference_sha256:sha,generation_policy:z.literal("reference_dialogue_v2").optional(),
  seconds:z.literal(5),aspect_ratio:z.literal("9:16"),seed:z.number().int().min(0).max(2147483647),
  native_dialogue:z.object({speaker:z.string().min(1).max(100),language:z.literal("pt-BR"),text:z.string().min(4).max(120),voice_description:z.string().min(20).max(240)}).strict(),
  chapter_binding:z.object({episode_id:z.string().uuid(),fingerprint:sha,shot_index:z.number().int().min(0).max(8)}).strict(),
}).strict();
export type PuterShot=z.infer<typeof puterShotSchema>;
export function puterPrompt(input:unknown) {
  const s=puterShotSchema.parse(input),d=s.native_dialogue;
  if(d.text.trim().split(/\s+/).length<3||d.text.trim().split(/\s+/).length>8)throw new PuterError("invalid_dialogue");
  return `${s.prompt}\nOnly ${d.speaker} speaks, visibly on camera. Native audio in Brazilian Portuguese (pt-BR). `+
    `Voice direction: ${d.voice_description}\nSay exactly, without extra words: ${JSON.stringify(d.text)}. `+
    `Synchronize mouth movement to that speech. No narrator, voice-over, music, subtitles, text or cuts. `+
    `Preserve reference identity, clothing, eyes, hands and proportions. One restrained body gesture; natural breathing and expression. End with a brief silent reaction.`;
}
export function puterFilename(key:string){return `content-ai-puter-${sha.parse(key)}.mp4`;}
export async function puterRequestKey(shot:unknown,account:string) {
  return sha256Hex(canonicalStringify({provider:"puter",account:sha.parse(account),contract:NATIVE_PUTER.contractSha256,shot:puterShotSchema.parse(shot)}));
}
export function puterCurrentFree(raw:unknown,account?:string,now=Date.now()) {
  const p=puterInspectionSchema.safeParse(raw);if(!p.success)return false;const r=p.data,age=now-Date.parse(r.checked_at);
  return age>=0&&age<=120_000&&r.financially_eligible&&r.contract_sha256===NATIVE_PUTER.contractSha256&&r.monthly_allowance===1000&&
    r.remaining_credits!==null&&r.blockers.every(b=>b==="insufficient_free_credits")&&(!account||r.account_sha256===account);
}

export class PuterVideoProvider {
  #token:string;#fetch:typeof fetch;#now:()=>Date;
  constructor(token:string,{fetchImpl=fetch,now=()=>new Date()}:{fetchImpl?:typeof fetch;now?:()=>Date}={}) {
    if(typeof token!=="string"||token.length<16||token.length>8192||/\s|[\x00-\x1f\x7f]/.test(token))throw new PuterError("missing_credentials");
    this.#token=token;this.#fetch=fetchImpl;this.#now=now;
  }
  async #bytes(response:Response,maximum:number):Promise<Buffer> {
    const reader=response.body?.getReader();if(!reader)throw new PuterError("provider_response_invalid");
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;
      if(size>maximum){await reader.cancel();throw new PuterError("provider_response_too_large");}chunks.push(value);
    }}finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  async #request(path:string,body?:Record<string,unknown>,generation=false):Promise<Response> {
    if(!["/whoami","/metering/usage","/drivers/call","/df","/delete"].includes(path)&&!path.startsWith("/read?file="))throw new PuterError("unsupported_endpoint");
    let r:Response;
    try{r=await this.#fetch(origin+path,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${this.#token}`,"Content-Type":"application/json",Accept:"application/json", "Cache-Control":"no-cache"},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(generation?600_000:30_000)});}
    catch{throw new PuterError("provider_response_unresolved",generation?"unknown":"none");}
    if(!r.ok) {
      if(r.status===404&&!generation)throw new PuterError("remote_file_not_ready");
      const code=({401:"invalid_token",402:"insufficient_free_credits",403:"provider_access_denied",429:"rate_limited"} as Record<number,string>)[r.status]??"provider_request_failed";
      // HTTP status alone cannot prove that no upstream render was accepted.
      throw new PuterError(code,generation?"unknown":"none");
    }
    return r;
  }
  async #json(path:string,body?:Record<string,unknown>,generation=false):Promise<unknown> {
    const r=await this.#request(path,body,generation);
    try{return JSON.parse((await this.#bytes(r,4*1024*1024)).toString("utf8"));}
    catch{throw new PuterError("provider_response_invalid",generation?"unknown":"none");}
  }
  async #identity() {
    const r=await this.#json("/whoami");
    const id=z.object({uuid:z.string().uuid(),username:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)}).safeParse(r);
    if(!id.success||!record(r))throw new PuterError("unknown_account_schema");
    return {raw:r,username:id.data.username,account:await sha256Hex(`puter:${id.data.uuid}`)};
  }
  async inspect():Promise<PuterInspection> {
    const identity=await this.#identity();
    const settled=await Promise.allSettled([this.#json("/metering/usage"),this.#json("/drivers/call",{interface:"puter-video-generation",driver:"ai-video",method:"models",args:{}}),this.#json("/df",{})]);
    for(const item of settled)if(item.status==="rejected")throw item.reason;
    const usage=settled[0].status==="fulfilled"?settled[0].value:null,catalog=settled[1].status==="fulfilled"?settled[1].value:null;
    const blockers:string[]=[],a=record(usage)&&record(usage.allowanceInfo)?usage.allowanceInfo:null;
    const freeFlags={subscribed:false,subscription:null,is_temp:false,email_confirmed:true,requires_email_confirmation:false,
      requires_phone_verification:false,requires_card_verification:false,card_fallback_available:false};
    if(Object.entries(freeFlags).some(([key,value])=>!Object.hasOwn(identity.raw,key)||identity.raw[key]!==value))blockers.push("free_account_unverified");
    if(!a||a.unit!=="credits"||a.monthUsageAllowance!==1000||!money(a.remaining))blockers.push("free_allowance_unverified");
    const addons=a&&record(a.addons)?a.addons:null;
    if(!addons||Object.values(addons).some(v=>v!==0&&v!==null&&!(record(v)&&Object.keys(v).length===0)))blockers.push("purchased_credit_or_addon_unverified");
    const remaining=a?.unit==="credits"&&money(a.remaining)?a.remaining:null;
    if(remaining!==null&&remaining>1000)blockers.push("purchased_credit_or_addon_unverified");
    const models=record(catalog)&&catalog.success===true&&Array.isArray(catalog.result)?catalog.result:[];
    const matches=models.filter(m=>record(m)&&m.id===NATIVE_PUTER.model&&m.provider===NATIVE_PUTER.upstream);
    const m=matches[0],has=(key:string,value:unknown)=>record(m)&&Array.isArray(m[key])&&m[key].includes(value);
    const contract=matches.length===1&&record(m)&&m.costs_currency==="usd-cents"&&record(m.costs)&&m.costs["per-second"]===2&&
      has("durationSeconds",5)&&has("fps",30)&&has("dimensions","720P")&&has("ratios","9:16")&&has("keyframes","first");
    if(!contract)blockers.push("video_contract_changed");
    const space=settled[2].status==="fulfilled"?settled[2].value:null;
    const freeBytes=record(space)&&money(space.capacity)&&money(space.used)&&space.used<=space.capacity?Math.floor(space.capacity-space.used):null;
    if(freeBytes===null||freeBytes<8*1024*1024)blockers.push("storage_capacity_unavailable");
    const financial=blockers.length===0;
    if(remaining!==null&&remaining<NATIVE_PUTER.creditsPerShot)blockers.push("insufficient_free_credits");
    return puterInspectionSchema.parse({provider:"puter",account_sha256:identity.account,checked_at:this.#now().toISOString(),
      remaining_credits:remaining,monthly_allowance:a?.monthUsageAllowance===1000?1000:null,storage_free_bytes:freeBytes,unit:"credits",financially_eligible:financial,
      contract_sha256:contract?NATIVE_PUTER.contractSha256:null,budget_basis:NATIVE_PUTER.budgetBasis,provider_quote:false,blockers:[...new Set(blockers)]});
  }
  /** Caller durably saves submission_started and account lease BEFORE calling this method. */
  async submit(input:unknown,image:Uint8Array,key:string,report:PuterInspection) {
    const shot=puterShotSchema.parse(input);
    if(!puterCurrentFree(report,undefined,this.#now().getTime())||report.remaining_credits!<NATIVE_PUTER.creditsPerShot)throw new PuterError("native_financial_gate_closed");
    if(await puterRequestKey(shot,report.account_sha256)!==key||createHash("sha256").update(image).digest("hex")!==shot.reference_sha256||!image.length||image.length>NATIVE_PUTER.maxImageBytes)throw new PuterError("request_identity_changed");
    const result=await this.#json("/drivers/call",{interface:"puter-video-generation",driver:"ai-video",method:"generate",test_mode:false,args:{
      model:NATIVE_PUTER.model,provider:NATIVE_PUTER.upstream,seconds:5,size:"720P",width:720,height:1280,fps:30,
      generate_audio:true,seed:shot.seed,prompt:puterPrompt(shot),negative_prompt:"blurry eyes, deformed hands, missing fingers, identity change, wardrobe change, subtitles, text, frozen body",
      input_reference:`data:image/png;base64,${Buffer.from(image).toString("base64")}`,puter_output_path:`~/${puterFilename(key)}`,
    }},true);
    if(!record(result)||result.success!==true)throw new PuterError("submission_unknown","unknown");
    // Deliberately discard provider URLs. Recovery uses only the private filesystem path.
    return puterFilename(key);
  }
  async download(key:string,account:string) {
    const id=await this.#identity();if(id.account!==sha.parse(account))throw new PuterError("account_changed");
    const r=await this.#request(`/read?file=${encodeURIComponent(`/${id.username}/${puterFilename(key)}`)}`);
    const bytes=await this.#bytes(r,NATIVE_PUTER.maxVideoBytes);
    if(bytes.length<64||bytes.subarray(4,8).toString()!=="ftyp")throw new PuterError("video_response_invalid");
    return bytes;
  }
  /** Only after the same bytes are durably verified in Studio; never directories or arbitrary paths. */
  async removeVerifiedCopy(key:string,account:string,expectedSha256:string) {
    sha.parse(expectedSha256);const id=await this.#identity();if(id.account!==sha.parse(account))throw new PuterError("account_changed");
    let bytes:Buffer;
    try{bytes=await this.download(key,account);}catch(e){if(e instanceof PuterError&&e.code==="remote_file_not_ready")return;throw e;}
    if(createHash("sha256").update(bytes).digest("hex")!==expectedSha256)throw new PuterError("remote_copy_changed_no_cleanup");
    const r=await this.#request("/delete",{paths:[`/${id.username}/${puterFilename(key)}`],recursive:false,descendants_only:false});
    await r.body?.cancel();
  }
}
