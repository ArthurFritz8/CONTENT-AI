import {nativeChapterPrompt,prepareNativeDraft,nativeFingerprint} from "../../../packages/core/src/stories/native-chapter.ts";
import {nativeProfileSchema} from "../../../packages/core/src/stories/native-contract.ts";
import {canonicalStringify,sha256Hex} from "../../../packages/core/src/validators/hash-utils.ts";
import {extractJson} from "./gemini.ts";
import {writeStory} from "./story-writer.ts";
import {AppError,jsonResponse} from "./error-handler.ts";
import {markEpisodeFailed} from "./episode-utils.ts";
import type {JobLogger} from "./logger.ts";
import type {createServiceClient} from "./supabase-client.ts";

export async function generateNativeStoryDraft(db:ReturnType<typeof createServiceClient>,logger:JobLogger,episode:string,context:unknown,production:{profile:unknown;profile_sha256:string}) {
  const profile=nativeProfileSchema.parse(production.profile);
  if(await sha256Hex(canonicalStringify(profile))!==production.profile_sha256)throw new AppError("O padrão nativo foi alterado",422,"PRODUCTION_PROFILE_INVALID");
  const {data:prior,error:read}=await db.from("studio_native_preparations").select("episode_id").eq("episode_id",episode).maybeSingle();
  if(read)throw new AppError("Plano nativo indisponível",503,"NATIVE_SETUP_REQUIRED");
  if(prior)return jsonResponse({episode_id:episode,native_chapter:true,code:"prepared"});
  let correction="";
  for(const attempt of [1,2]) {
    const result=await writeStory(db,logger,nativeChapterPrompt(context,profile)+(correction?`\nCorrija: ${correction}`:""),episode);
    let draft;
    try{draft=prepareNativeDraft(extractJson(result.text),context,profile);}catch(e){correction=e instanceof Error?e.message.slice(0,1200):"Rascunho inválido";continue;}
    const {data,error}=await db.rpc("save_native_draft",{p_episode:episode,p_profile:production.profile_sha256,p_fingerprint:await nativeFingerprint(draft,context,profile),p_draft:draft});
    if(error)throw new AppError("Não foi possível salvar as três tomadas",503,"NATIVE_DRAFT_SAVE_FAILED");
    return jsonResponse({episode_id:episode,native_chapter:true,code:data.code});
  }
  await markEpisodeFailed(db,logger,episode,"native_draft_invalid",correction,"research");
  throw new AppError("As falas precisam ser corrigidas antes de usar créditos de vídeo",422,"NATIVE_DRAFT_INVALID");
}
