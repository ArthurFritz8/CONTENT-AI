import { appUrl,body,config,errorResponse,requireUser } from "../../../../lib/server";
import { assertOrigin,uuid,PanelError } from "../../../../lib/security.mjs";
import { studioRpc } from "../../../../lib/workspace";
import { seriesProductionProfileSchema,productionProfileHash } from "../../../../../../packages/core/src/stories/production";
import { downloadProductionMedia } from "../../../../lib/production-storage";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try { const user=await requireUser();return Response.json(await studioRpc("studio_production_setup_view",{p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(new URL(request.url).searchParams.get("series"))}),{headers:{"Cache-Control":"no-store"}}); }
  catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
  try {
    assertOrigin(request,appUrl());const user=await requireUser(),input=await body(request),series=uuid(input.seriesId);
    const args={p_workspace:user.workspaceId,p_actor:user.id,p_series:series};
    if(input.action==="voices") {
      const cfg=config();
      const res=await fetch(`${cfg.url}/functions/v1/studio-story`,{method:"POST",headers:{apikey:cfg.service,Authorization:`Bearer ${cfg.service}`,"Content-Type":"application/json"},body:JSON.stringify({action:"profile_voices",workspace:user.workspaceId,actor:user.id,series_id:series}),signal:AbortSignal.timeout(25000),redirect:"error"});
      if(!res.ok)throw new PanelError("Não foi possível iniciar as prévias. Aguarde alguns minutos e tente novamente.",502);
      const result=await res.json();
      return Response.json(result,{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action!=="finalize" || input.confirmed!==true || !Array.isArray(input.selection))throw new PanelError("Confira as imagens e ouça as vozes antes de fixar o padrão.",400);
    const view=await studioRpc("studio_production_setup_view",args);
    if(!view.can_configure && !view.profile)throw new PanelError("Esta novela já foi iniciada.",409);
    if(input.selection.length!==view.bible.cast.length)throw new PanelError("Escolha uma imagem e uma voz para cada personagem.",400);
    const references=[],voices=[];
    for(const c of view.bible.cast) {
      const selected=input.selection.filter((v:{character_id?:string})=>v.character_id===c.id);
      if(selected.length!==1)throw new PanelError("Elenco incompleto.",400);
      const ref=view.media.find((m:{id:string;kind:string;character_id:string})=>m.id===selected[0].reference_id && m.kind==="reference" && m.character_id===c.id);
      const sample=view.media.find((m:{id:string;kind:string;character_id:string})=>m.id===selected[0].voice_id && m.kind==="voice_sample" && m.character_id===c.id);
      if(!ref || !sample)throw new PanelError("Imagem ou voz ainda não está pronta.",409);
      const reference=await studioRpc("studio_production_media_read",{p_workspace:user.workspaceId,p_actor:user.id,p_id:ref.id});
      const audio=await studioRpc("studio_production_media_read",{p_workspace:user.workspaceId,p_actor:user.id,p_id:sample.id});
      // Verify stored immutable bytes, rather than accepting browser paths or hashes.
      await Promise.all([downloadProductionMedia(reference,user.workspaceId),downloadProductionMedia(audio,user.workspaceId)]);
      references.push({character_id:c.id,path:reference.path,sha256:reference.sha256});
      voices.push({character_id:c.id,engine:audio.metadata.engine,voice_id:audio.metadata.voice_id,version:audio.metadata.version,sample_sha256:audio.sha256});
    }
    const parsed=seriesProductionProfileSchema.safeParse({version:"1.0.0",orientation:"portrait",short_edge:704,output_fps:60,style:input.style,references,voices});
    if(!parsed.success)throw new PanelError("Descreva o estilo em 30 a 3.000 caracteres.",400);
    const result=await studioRpc("studio_production_finalize",{...args,p_profile:parsed.data,p_hash:await productionProfileHash(parsed.data)});
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(e){return errorResponse(e);}
}
