import {errorResponse,requireUser} from "../../../../lib/server";
import {studioRpc} from "../../../../lib/workspace";
import {storyStyles} from "../../../../../../packages/core/src/stories/styles";
export const dynamic="force-dynamic";
export async function GET() {
  try {
    const user=await requireUser();
    const samples=await studioRpc("studio_story_style_gallery",{p_workspace:user.workspaceId,p_actor:user.id});
    return Response.json({styles:storyStyles,samples},{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return errorResponse(e);}
}
