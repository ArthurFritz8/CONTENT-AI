import {appUrl,body,errorResponse,requireUser} from "../../../../lib/server";
import {assertOrigin,PanelError,uuid} from "../../../../lib/security.mjs";
import {studioRpc} from "../../../../lib/workspace";
import {nativeRepairSchema,repairNativeDraft} from "../../../../../../packages/core/src/stories/native-repair";
import {nativeFingerprint} from "../../../../../../packages/core/src/stories/native-chapter";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 try{const user=await requireUser();return Response.json(await studioRpc("studio_native_repair_view",{p_workspace:user.workspaceId,p_actor:user.id,p_episode:uuid(new URL(request.url).searchParams.get("episode"))}),{headers:{"Cache-Control":"no-store"}});}catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
 try{
  assertOrigin(request,appUrl());const user=await requireUser(),input=await body(request),args={p_workspace:user.workspaceId,p_actor:user.id,p_episode:uuid(input.episodeId)};
  if(input.action==="restore")return Response.json(await studioRpc("studio_native_repair_restore",args),{headers:{"Cache-Control":"no-store"}});
  if(input.action!=="repair" || input.confirmed!==true)throw new PanelError("Confirme a refação de uma cena por até cinco créditos gratuitos.",400);
  const edit=nativeRepairSchema.safeParse(input.edit);if(!edit.success)throw new PanelError("Confira a fala, o resumo e a direção da cena.",400);
  const view=await studioRpc("studio_native_repair_view",args);
  // Replays must reach the idempotent RPC even if the original is no longer current.
  let draft;try{draft=repairNativeDraft(view.draft,view.context,view.profile,edit.data);}catch(e){throw new PanelError(e instanceof Error?e.message:"Cena inválida.",400);}
  return Response.json(await studioRpc("studio_native_repair_prepare",{...args,p_request:uuid(input.requestId),p_edit:edit.data,p_draft:draft,p_fingerprint:await nativeFingerprint(draft,view.context,view.profile)}),{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e);}
}
