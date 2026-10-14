import {config,errorResponse,requireUser} from "../../../../../lib/server";
import {uuid,PanelError} from "../../../../../lib/security.mjs";
import {studioRpc} from "../../../../../lib/workspace";
import {readVerifiedAurayMedia} from "../../../../../lib/verified-private-media.mjs";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request) {
  try {
    const user=await requireUser(),id=uuid(new URL(request.url).searchParams.get("id"));
    const row=await studioRpc("studio_auray_media_read",{p_workspace:user.workspaceId,p_actor:user.id,p_job:id});
    let bytes;
    try {const c=config();bytes=await readVerifiedAurayMedia(row,c.url,c.service);}
    catch {throw new PanelError("Teste indisponível. Atualize a consulta para verificar o trabalho.",502);}
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"video/mp4","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(e){return errorResponse(e);}
}
