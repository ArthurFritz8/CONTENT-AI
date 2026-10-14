import {config,errorResponse,requireUser} from "../../../../../lib/server";
import {uuid,PanelError} from "../../../../../lib/security.mjs";
import {studioRpc} from "../../../../../lib/workspace";
import {readVerifiedStorySample} from "../../../../../lib/verified-private-media.mjs";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request) {
  try {
    const user=await requireUser(),id=uuid(new URL(request.url).searchParams.get("id"));
    const row=await studioRpc("studio_story_style_media",{p_workspace:user.workspaceId,p_actor:user.id,p_id:id});
    let bytes;
    try {const c=config();bytes=await readVerifiedStorySample(row,user.workspaceId,c.url,c.service);}
    catch {throw new PanelError("Exemplo indisponível. Tente novamente mais tarde.",502);}
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"video/mp4","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(e){return errorResponse(e);}
}
