import {appUrl,body,errorResponse,requireUser} from "../../../../lib/server";
import {assertOrigin,PanelError} from "../../../../lib/security.mjs";
import {studioRpc} from "../../../../lib/workspace";
import {queueCommandSchema,queueEnqueueTarget,videoQueuePreview} from "../../../../lib/video-queue";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET() {
 try {
  const user=await requireUser();
  const snapshot=await studioRpc("studio_video_queue_snapshot",{p_workspace:user.workspaceId,p_actor:user.id});
  return Response.json(videoQueuePreview(snapshot),{headers});
 }catch(error){return errorResponse(error);}
}
export async function POST(request:Request) {
 try {
  assertOrigin(request,appUrl());const user=await requireUser();
  const parsed=queueCommandSchema.safeParse(await body(request,2000));
  if(!parsed.success)throw new PanelError("Confira o capítulo e atualize a fila.",400);
  const input=parsed.data;
  if(input.action==="cancel")return Response.json(await studioRpc("studio_video_queue_cancel",{
   p_workspace:user.workspaceId,p_actor:user.id,p_queue:input.queueId,p_revision:input.revision}),{headers});
  const snapshot=await studioRpc("studio_video_queue_snapshot",{p_workspace:user.workspaceId,p_actor:user.id});
  const target=queueEnqueueTarget(snapshot,input.episodeId);
  if(!target)throw new PanelError("O capítulo precisa estar preparado e disponível neste workspace.",409);
  return Response.json(await studioRpc("studio_video_enqueue",{p_workspace:user.workspaceId,p_actor:user.id,p_request:input.requestId,
   p_episode:target.episode_id,p_profile:target.profile_sha256}),{headers});
 }catch(error){return errorResponse(error);}
}