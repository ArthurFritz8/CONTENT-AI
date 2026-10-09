import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { synthesizeOnRunner } from "./tts-runner.ts";
import { seriesBibleSchema } from "../../../packages/core/src/stories/schema.ts";

export function inspectVoiceSample(bytes:Uint8Array) {
  if(bytes.length<44 || bytes.length>524288)throw Error("Amostra de voz inválida");
  const text=(start:number,n:number)=>new TextDecoder().decode(bytes.subarray(start,start+n));
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(text(0,4)!=="RIFF" || text(8,4)!=="WAVE" || view.getUint32(4,true)+8!==bytes.length)throw Error("WAV inválido");
  let fmt=false,frames=0;
  for(let offset=12;offset+8<=bytes.length;) {
    const name=text(offset,4),size=view.getUint32(offset+4,true),start=offset+8;
    if(start+size>bytes.length)throw Error("WAV truncado");
    if(name==="fmt ") {if(fmt || size<16 || view.getUint16(start,true)!==1 || view.getUint16(start+2,true)!==1 || view.getUint32(start+4,true)!==16000 || view.getUint16(start+12,true)!==2 || view.getUint16(start+14,true)!==16)throw Error("PCM incompatível");fmt=true;}
    if(name==="data") {if(frames || size%2)throw Error("PCM inválido");frames=size/2;}
    offset=start+size+(size%2);
  }
  const seconds=frames/16000;
  if(!fmt || seconds<.1 || seconds>12)throw Error("Duração da voz inválida");
  return seconds;
}
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)))].map(v=>v.toString(16).padStart(2,"0")).join("");
export async function prepareProfileVoices(db:SupabaseClient,series:string,synthesize=synthesizeOnRunner) {
  const token=crypto.randomUUID();
  async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await db.rpc(name,args);if(error)throw Error("Cadastro da voz indisponível");return data;}
  const claim=await rpc("claim_profile_voices",{p_series:series,p_token:token});
  if(claim.code!=="claimed")return claim;
  const bible=seriesBibleSchema.parse(claim.bible),storage=db.storage.from("studio-private");
  const dir=await Deno.makeTempDir({prefix:"content-ai-voice-preview-"});
  try {
    for(const c of bible.cast) {
      const voice=c.voice==="female"?"pt-BR-FranciscaNeural":"pt-BR-AntonioNeural";
      const saved=claim.media.find((m:{character_id:string;metadata:{voice_id:string}})=>m.character_id===c.id && m.metadata.voice_id===voice);
      if(saved) {
        const {data,error}=await storage.download(saved.path);
        if(error || !data || data.size!==saved.bytes || data.size>524288)throw Error("Amostra salva indisponível");
        const bytes=new Uint8Array(await data.arrayBuffer());if(await hash(bytes)!==saved.sha256)throw Error("Amostra alterada");inspectVoiceSample(bytes);continue;
      }
      const result=await synthesize("edge","Olá! Vamos descobrir juntos o segredo desta história.",{voice_pt_br:voice,edge_rate:"+0%"});
      await Deno.writeFile(`${dir}/source.mp3`,result.bytes);
      const converted=await new Deno.Command("ffmpeg",{args:["-y","-v","error","-i",`${dir}/source.mp3`,"-vn","-ar","16000","-ac","1","-c:a","pcm_s16le",`${dir}/sample.wav`],stdout:"null",stderr:"piped",signal:AbortSignal.timeout(30000)}).output();
      if(!converted.success)throw Error("Conversão da voz não concluiu");
      const bytes=await Deno.readFile(`${dir}/sample.wav`),seconds=inspectVoiceSample(bytes),sha=await hash(bytes);
      const row=await rpc("studio_production_media_reserve",{p_workspace:claim.workspace_id,p_actor:claim.actor,p_series:series,p_id:crypto.randomUUID(),p_character:c.id,p_kind:"voice_sample",p_sha:sha,p_bytes:bytes.length,p_metadata:{mime:"audio/wav",seconds,voice_id:voice,engine:"edge",version:"edge-tts-7.2.8-rate0"}});
      const {error:uploadError}=await storage.upload(row.path,bytes,{contentType:"audio/wav",upsert:false});
      if(uploadError){const {data,error}=await storage.download(row.path);if(error || !data || data.size!==bytes.length || await hash(new Uint8Array(await data.arrayBuffer()))!==sha)throw Error("Amostra não foi armazenada");}
      await rpc("studio_production_media_ready",{p_workspace:claim.workspace_id,p_actor:claim.actor,p_id:row.id,p_sha:sha});
    }
    return await rpc("finish_profile_voices",{p_series:series,p_token:token,p_success:true});
  }catch(error){try{await rpc("finish_profile_voices",{p_series:series,p_token:token,p_success:false});}catch{/* Preserve original failure. */}throw error;}
  finally {await Deno.remove(dir,{recursive:true});}
}
