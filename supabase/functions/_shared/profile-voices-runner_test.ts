import { inspectVoiceSample,prepareProfileVoices } from "./profile-voices-runner.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assertEquals,assertRejects,assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
function wav(seconds=1){const bytes=new Uint8Array(44+seconds*32000),view=new DataView(bytes.buffer);const set=(offset:number,text:string)=>bytes.set(new TextEncoder().encode(text),offset);set(0,"RIFF");view.setUint32(4,bytes.length-8,true);set(8,"WAVE");set(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);set(36,"data");view.setUint32(40,bytes.length-44,true);return bytes;}
Deno.test("voice preview validates exact PCM and bounded duration",()=>{
  assertEquals(inspectVoiceSample(wav()),1);
  const stereo=wav();new DataView(stereo.buffer).setUint16(22,2,true);assertThrows(()=>inspectVoiceSample(stereo));
  const truncated=wav().subarray(0,100);assertThrows(()=>inspectVoiceSample(truncated));assertThrows(()=>inspectVoiceSample(wav(13)));
});
const bible={kind:"fruits",genre:"mystery",title:"A chave da feira",premise:"Duas frutas encontram uma chave misteriosa na feira.",cast:[{id:"lia",name:"Lia",appearance:"apple",color:"#ef1234",personality:"Curiosa e amiga de todos.",voice:"female"},{id:"rui",name:"Rui",appearance:"orange",color:"#fab123",personality:"Impulsivo e muito curioso.",voice:"male"}],chapters:[{title:"A chave misteriosa",arc:"Encontram a chave dourada e descobrem quem poderia ter perdido aquele objeto na feira."}]};
Deno.test("voice previews save each character with no video dispatch or alternate engine",async()=>{
  const calls:string[]=[],objects=new Map<string,Uint8Array>();let syntheses=0;
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name==="claim_profile_voices")return {data:{code:"claimed",workspace_id:"workspace",actor:"owner",bible,media:[]},error:null};if(name==="studio_production_media_reserve")return {data:{id:args.p_id,path:`workspace/${args.p_id}`},error:null};return {data:{code:"ready"},error:null};},storage:{from:()=>({upload:(path:string,bytes:Uint8Array)=>{objects.set(path,bytes);return {error:null};}})}} as unknown as SupabaseClient;
  const synthesize:Parameters<typeof prepareProfileVoices>[2]=async(engine,text,cfg)=>{assertEquals(engine,"edge");assertEquals(cfg.edge_rate,"+0%");assertEquals(text.includes("segredo"),true);syntheses++;return {engine:"edge",bytes:wav(),extension:"wav",mimeType:"audio/wav",duration_seconds:1,word_boundaries:null};};
  assertEquals((await prepareProfileVoices(db,"series",synthesize)).code,"ready");assertEquals(syntheses,2);assertEquals(objects.size,2);
  assertEquals(calls.filter(n=>n==="studio_production_media_ready").length,2);assertEquals(calls.some(n=>/video|animation/.test(n)),false);
});
Deno.test("failed voice preview releases its lease and preserves earlier samples",async()=>{
  let success:unknown;
  const db={rpc:async(name:string,args:Record<string,unknown>)=>{if(name==="claim_profile_voices")return {data:{code:"claimed",workspace_id:"workspace",actor:"owner",bible,media:[]},error:null};if(name==="finish_profile_voices")success=args.p_success;return {data:{code:"failed"},error:null};},storage:{from:()=>({})}} as unknown as SupabaseClient;
  await assertRejects(()=>prepareProfileVoices(db,"series",()=>Promise.reject(Error("network"))));assertEquals(success,false);
});
Deno.test("duplicate voice runner does not call TTS",async()=>{
  const db={rpc:()=>Promise.resolve({data:{code:"waiting"},error:null})} as unknown as SupabaseClient;
  const result=await prepareProfileVoices(db,"series",()=>{throw Error("must not synthesize");});assertEquals(result.code,"waiting");
});
