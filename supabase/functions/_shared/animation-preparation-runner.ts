import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { validateAnimatedDraft, preparationFingerprint, planAnimatedChapter } from "../../../packages/core/src/stories/animated-preparation.ts";
import { seriesProductionProfileSchema, productionProfileHash } from "../../../packages/core/src/stories/production.ts";
import { animatedSceneSchema } from "../../../packages/core/src/stories/animation-contract.ts";
import { canonicalStringify, sha256Hex, computeScriptHash } from "../../../packages/core/src/validators/hash-utils.ts";
import { synthesizeOnRunner } from "./tts-runner.ts";
import { loadScriptQualityChecker, recordScriptQuality } from "./script-quality.ts";

const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,"0")).join("");
async function command(name: string, args: string[], input?: unknown) {
  const child = new Deno.Command(name,{args,signal:AbortSignal.timeout(90_000),stdin:input ? "piped":"null",stdout:"piped",stderr:"piped"}).spawn();
  if (input) { const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(JSON.stringify(input)));await writer.close(); }
  const result=await child.output();
  if(!result.success)throw Error("Áudio ou referência fora do contrato; confira duração e arquivos antes de continuar");
  return new TextDecoder().decode(result.stdout);
}
export async function prepareAnimation(db: SupabaseClient, episodeId: string, synthesize = synthesizeOnRunner) {
  const token=crypto.randomUUID();
  try {return await prepareClaimedAnimation(db,episodeId,token,synthesize);}
  catch(error) {
    // A late failure cannot undo a completed script or another runner's lease.
    try {await db.rpc("fail_animation_preparation",{p_episode:episodeId,p_token:token});} catch { /* Original error is preserved. */ }
    throw error;
  }
}
async function prepareClaimedAnimation(db: SupabaseClient,episodeId:string,token:string,synthesize:typeof synthesizeOnRunner) {
  async function rpc(name: string, args: Record<string,unknown>) {
    const {data,error}=await db.rpc(name,args);if(error)throw Error(`Não foi possível salvar a etapa ${name}`);return data;
  }
  const claim=await rpc("claim_animation_preparation",{p_episode:episodeId,p_token:token});
  if(claim.code!=="claimed")return claim;
  const preparation=claim.preparation;
  const {data:production,error}=await db.from("studio_series_production").select("profile,profile_sha256").eq("series_id",preparation.context.series_id).eq("workspace_id",preparation.workspace_id).single();
  if(error||!production)throw Error("Padrão audiovisual indisponível");
  const profile=seriesProductionProfileSchema.parse(production.profile);
  const draft=validateAnimatedDraft(preparation.draft,preparation.context,profile);
  if(await productionProfileHash(profile)!==preparation.profile_sha256 || production.profile_sha256!==preparation.profile_sha256 ||
    await preparationFingerprint(draft,preparation.context,profile)!==preparation.fingerprint)throw Error("Plano audiovisual alterado");
  const storage=db.storage.from("studio-private");
  async function download(path: string, maximum: number, sha: string) {
    if(!path.startsWith(`${preparation.workspace_id}/`) || /\.\.|\\|[?#]/.test(path))throw Error("Arquivo fora do espaço da novela");
    const {data,error}=await storage.download(path);if(error||!data||data.size>maximum||!data.size)throw Error("Arquivo ausente ou maior que o permitido");
    const bytes=new Uint8Array(await data.arrayBuffer());if(await digest(bytes)!==sha)throw Error("Arquivo diferente do aprovado");return bytes;
  }
  const takes=[];
  const directory=await Deno.makeTempDir({prefix:"content-ai-animation-audio-"});
  try {
    for(const [i,scene] of draft.scenes.entries()) {
      const id=`take_${i}`, voice=profile.voices.find(v=>v.character_id===scene.visual.speaker_id)!;
      const ref=profile.references.find(v=>v.character_id===voice.character_id)!;
      const png=await download(ref.path,12*1024*1024,ref.sha256);
      const saved=claim.audio.find((b: {shot_id:string})=>b.shot_id===id);
      let wav: Uint8Array, binding;
      if(saved) {
        binding=animatedSceneSchema.parse(saved);
        if(binding.character_id!==voice.character_id || binding.voice_sha256!==await sha256Hex(canonicalStringify(voice)) ||
          binding.reference_path!==ref.path || binding.reference_sha256!==ref.sha256 || binding.prompt!==scene.prompt || binding.seed!==scene.seed)
          throw Error("Checkpoint diferente do elenco, da voz ou da direção aprovada");
        wav=await download(binding.audio_path,1024*1024,binding.audio_sha256);
      } else {
        // Never use the legacy TTS fallback chain or alter speed to fit a shot.
        const audio=await synthesize("edge",scene.narration_text,{voice_pt_br:voice.voice_id,edge_rate:"+0%"});
        await Deno.writeFile(`${directory}/source.mp3`,audio.bytes);
        await command("ffmpeg",["-y","-v","error","-i",`${directory}/source.mp3`,"-vn","-ar","16000","-ac","1","-c:a","pcm_s16le",`${directory}/voice.wav`]);
        wav=await Deno.readFile(`${directory}/voice.wav`);
        const hash=await digest(wav);
        binding=animatedSceneSchema.parse({shot_id:id,character_id:voice.character_id,reference_path:ref.path,reference_sha256:ref.sha256,
          audio_path:`${preparation.workspace_id}/story-audio/${episodeId}/${preparation.fingerprint}/${id}/${hash}.wav`,audio_sha256:hash,
          // Replaced by measured PCM duration before uploading or committing a checkpoint.
          audio_seconds:1,voice_sha256:await sha256Hex(canonicalStringify(voice)),prompt:scene.prompt,seed:scene.seed});
      }
      await Deno.writeFile(`${directory}/reference.png`,png);await Deno.writeFile(`${directory}/voice.wav`,wav);
      const measured=JSON.parse(await command("python",["scripts/inspect-story-inputs.py"],{png_path:`${directory}/reference.png`,wav_path:`${directory}/voice.wav`,
        reference_sha256:ref.sha256,audio_sha256:binding.audio_sha256,prompt:scene.prompt,seed:scene.seed}));
      if(saved && Math.abs(measured.audio_seconds-binding.audio_seconds)>1/16000)throw Error("Duração diferente do checkpoint");
      binding=animatedSceneSchema.parse({...binding,audio_seconds:measured.audio_seconds});
      if(!saved) {
        const {error:uploadError}=await storage.upload(binding.audio_path,wav,{contentType:"audio/wav",upsert:false});
        // A timeout may have stored the immutable audio. Verify identical bytes instead of overwriting.
        if(uploadError)await download(binding.audio_path,1024*1024,binding.audio_sha256);
        await rpc("save_animation_audio",{p_episode:episodeId,p_token:token,p_binding:binding});
      }
      takes.push({reference_path:binding.reference_path,reference_sha256:binding.reference_sha256,audio_path:binding.audio_path,
        audio_sha256:binding.audio_sha256,audio_seconds:binding.audio_seconds,voice});
    }
    const planned=await planAnimatedChapter({draft,context:preparation.context,episodeId,profile,takes});
    const quality=await loadScriptQualityChecker(db),hash=await computeScriptHash(planned.script),report=quality.check(planned.script,[],false);
    await recordScriptQuality(db,episodeId,report,{stage:"generate-script",script_hash:hash,policy_hash:quality.policy_hash});
    if(!report.passed)throw Error("Roteiro animado reprovado na conferência; nenhuma GPU foi solicitada");
    return await rpc("complete_animation_preparation",{p_episode:episodeId,p_token:token,p_fingerprint:preparation.fingerprint,p_script:planned.script,
      p_hash:hash,p_quality:{...report,script_hash:hash,policy_hash:quality.policy_hash}});
  } finally { await Deno.remove(directory,{recursive:true}); }
}
