import {createHash} from "node:crypto";
import {appUrl,body,config,errorResponse,requireUser} from "../../../../lib/server";
import {assertOrigin,PanelError,uuid} from "../../../../lib/security.mjs";
import {studioRpc} from "../../../../lib/workspace";
import {cloudflareImageConnectionSchema,inspectCloudflareImages,ReferenceProviderError} from "../../../../../../packages/core/src/stories/cloudflare-images";
import {patternIdentity} from "../../../../lib/story-pattern";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const user=await requireUser(),series=new URL(request.url).searchParams.get("series");return Response.json(await studioRpc("studio_reference_view",{p_workspace:user.workspaceId,p_actor:user.id,p_series:series?uuid(series):null}),{headers:{"Cache-Control":"no-store"}});}catch(e){return errorResponse(e);}}
export async function POST(request:Request) {
 try{
  assertOrigin(request,appUrl());const user=await requireUser(),input=await body(request);
  if(input.action==="connect") {
   const parsed=cloudflareImageConnectionSchema.safeParse(input.credential);if(!parsed.success)throw new PanelError("Confira o ID da conta e o token Cloudflare.",400);
   let inspection;try{inspection=await inspectCloudflareImages(parsed.data);}catch(e){const code=e instanceof ReferenceProviderError?e.code:"connection_unavailable";throw new PanelError(code==="billing_permission_required"?"O token precisa permitir a leitura das assinaturas da conta para conferir o plano gratuito.":code==="free_plan_required"?"Esta conta não foi confirmada como Workers Free. A geração automática de imagens ficou bloqueada para evitar cobranças.":code==="ai_permission_required"?"Adicione a permissão Workers AI: Read ao token.":"Não foi possível confirmar o plano gratuito e o modelo de imagens. Nenhuma geração foi enviada.",422);}
   await studioRpc("studio_store_secret",{p_workspace:user.workspaceId,p_provider:"cloudflare_images",p_value:parsed.data,p_metadata:{...inspection,account_sha256:createHash("sha256").update(parsed.data.account_id).digest("hex")}});
   return Response.json({code:"connected",...inspection},{headers:{"Cache-Control":"no-store"}});
  }
  if(input.action!=="generate")throw new PanelError("Ação inválida.",400);
  const pattern=patternIdentity(input.revision,input.styleId);if(!pattern||typeof input.characterId!=="string")throw new PanelError("Confira o personagem e o estilo.",400);
  const c=config(),r=await fetch(`${c.url}/functions/v1/studio-story`,{method:"POST",headers:{apikey:c.service,Authorization:`Bearer ${c.service}`,"Content-Type":"application/json"},body:JSON.stringify({action:"references",workspace:user.workspaceId,actor:user.id,series_id:uuid(input.seriesId),request_id:uuid(input.requestId),revision:pattern.revision,style:pattern.style,character:input.characterId}),signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new PanelError("Não foi possível solicitar a imagem. O pedido fica salvo se o envio já tiver sido aceito.",502);
  return Response.json(await r.json(),{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e);}
}
