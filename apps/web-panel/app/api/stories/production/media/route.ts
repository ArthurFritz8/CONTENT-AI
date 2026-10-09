import { appUrl,errorResponse,requireUser } from "../../../../../lib/server";
import { assertOrigin,uuid,PanelError } from "../../../../../lib/security.mjs";
import { studioRpc } from "../../../../../lib/workspace";
import { boundedReferenceBody,normalizeProductionImage } from "../../../../../lib/production-image";
import { uploadProductionMedia,downloadProductionMedia } from "../../../../../lib/production-storage";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request) {
  try {
    const user=await requireUser(),id=uuid(new URL(request.url).searchParams.get("id"));
    const row=await studioRpc("studio_production_media_read",{p_workspace:user.workspaceId,p_actor:user.id,p_id:id});
    const bytes=await downloadProductionMedia(row,user.workspaceId);
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":row.kind==="reference"?"image/png":"audio/wav","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
  try {
    assertOrigin(request,appUrl());const user=await requireUser(),url=new URL(request.url);
    const series=uuid(url.searchParams.get("series")),id=uuid(url.searchParams.get("request")),character=url.searchParams.get("character") || "";
    if(!/^[a-z][a-z0-9_-]{0,23}$/.test(character))throw new PanelError("Personagem inválido.",400);
    // Check membership/cast before decoding an uploaded image.
    const view=await studioRpc("studio_production_setup_view",{p_workspace:user.workspaceId,p_actor:user.id,p_series:series});
    if(!view.can_configure || !view.bible.cast.some((c:{id:string})=>c.id===character))throw new PanelError("Configure as imagens antes de iniciar a novela.",409);
    const image=await normalizeProductionImage(await boundedReferenceBody(request));
    const args={p_workspace:user.workspaceId,p_actor:user.id};
    const row=await studioRpc("studio_production_media_reserve",{...args,p_series:series,p_id:id,p_character:character,p_kind:"reference",p_sha:image.sha256,p_bytes:image.bytes.length,p_metadata:image.metadata});
    if(!row.ready){await uploadProductionMedia(row,user.workspaceId,image.bytes,"image/png");await studioRpc("studio_production_media_ready",{...args,p_id:row.id,p_sha:image.sha256});}
    return Response.json({id:row.id},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return errorResponse(e);}
}
