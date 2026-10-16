import { appUrl, body, config, errorResponse, requireUser } from "../../../lib/server";
import { assertOrigin, PanelError, uuid } from "../../../lib/security.mjs";
import { studioRpc } from "../../../lib/workspace";
import { storyRequestSchema } from "../../../../../packages/core/src/stories/schema";
import {storyPresentationSchema,storyStyleIds} from "../../../../../packages/core/src/stories/styles";
import {storyEditorialSaveSchema,editorialSectionSchema,seasonSchema} from "../../../../../packages/core/src/stories/editorial";
export const dynamic = "force-dynamic";
async function edge(payload: Record<string, unknown>) {
  const cfg = config(), res = await fetch(`${cfg.url}/functions/v1/studio-story`, {
    method: "POST", headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(110000),
  });
  const result = await res.json();
  if (!res.ok) throw new PanelError(res.status < 500 ? result.error || "Proposta indisponível." : "Não foi possível criar a proposta. Tente mais tarde.", res.status);
  return result;
}
export async function GET(request:Request) {
  try {
    const user = await requireUser();
    const series=new URL(request.url).searchParams.get("series");
    if(series)return Response.json(await studioRpc("studio_story_editorial_view",{p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(series)}),{headers:{"Cache-Control":"no-store"}});
    const [overview, capacity, videoCapacity, animationProgress] = await Promise.all([
      studioRpc("studio_story_overview", { p_workspace: user.workspaceId, p_actor: user.id }),
      edge({ action: "capacity", workspace: user.workspaceId, actor: user.id }).catch(() => ({ estimated_script_capacity: 0, estimate: true, unavailable: true })),
      studioRpc("studio_video_overview", { p_workspace: user.workspaceId, p_actor: user.id }).catch(() => ({ wallets: [], series_profiles: [], unavailable: true, estimate_status: "setup_required" })),
      studioRpc("studio_animated_progress", { p_workspace: user.workspaceId, p_actor: user.id }).catch(() => ({ chapters: [], unavailable: true })),
    ]);
    return Response.json({ ...overview, capacity, videoCapacity, animationProgress, remaining: overview.active ? 0 : Math.min(overview.daily_remaining,capacity.estimated_script_capacity) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser(), input = await body(request,150000);
    if(input.action==="editorial") {
      const parsed=storyEditorialSaveSchema.safeParse(input.input);
      if(!parsed.success)throw new PanelError("Confira os textos, personagens e arcos. Um campo ficou fora do tamanho permitido.",400);
      return Response.json(await studioRpc("studio_story_editorial_save",{p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(input.seriesId),p_request:uuid(input.requestId),p_input:parsed.data}),{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="revise") {
      const section=editorialSectionSchema.safeParse(input.section);
      if(!section.success || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>999 || typeof input.guidance!=="string" || input.guidance.length>1000)throw new PanelError("Escolha a seção e confira a orientação.",400);
      return Response.json(await edge({action:"revise",workspace:user.workspaceId,actor:user.id,series_id:uuid(input.seriesId),request_id:uuid(input.requestId),revision:input.revision,section:section.data,guidance:input.guidance}),{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="editorial_suggest") {
      if(!["memory","season"].includes(input.section)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>999||!Number.isSafeInteger(input.chapters)||input.chapters<1||input.chapters>6)throw new PanelError("Confira o tipo de sugestão e a quantidade de capítulos.",400);
      return Response.json(await edge({action:"editorial_suggest",workspace:user.workspaceId,actor:user.id,series_id:uuid(input.seriesId),request_id:uuid(input.requestId),revision:input.revision,section:input.section,chapters:input.chapters}),{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="season") {
      const season=seasonSchema.safeParse(input.season);
      if(!season.success || !Number.isSafeInteger(input.revision) || input.revision<0 || input.revision>999)throw new PanelError("Confira o nome da temporada, os arcos e o desfecho.",400);
      return Response.json(await studioRpc("studio_story_season_add",{p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(input.seriesId),p_request:uuid(input.requestId),p_revision:input.revision,p_season:season.data}),{headers:{"Cache-Control":"no-store"}});
    }
    if(input.action==="native") {
      if(!["resume","cancel"].includes(input.operation))throw new PanelError("Ação inválida.",400);
      return Response.json(await edge({action:"native",workspace:user.workspaceId,actor:user.id,episode_id:uuid(input.episodeId),operation:input.operation}),{headers:{"Cache-Control":"no-store"}});
    }
    if (input.action === "balance") {
      return Response.json(await edge({action:"balance",workspace:user.workspaceId,actor:user.id,wallet_id:uuid(input.walletId)}), {headers:{"Cache-Control":"no-store"}});
    }
    if (["retry","archive"].includes(input.action)) {
      return Response.json(await studioRpc("studio_story_manage", { p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(input.seriesId),p_action:input.action }), { headers:{"Cache-Control":"no-store"} });
    }
    if (input.action === "next") {
      if(input.styleId!==undefined && !storyStyleIds.includes(input.styleId))throw new PanelError("Estilo inválido.",400);
      const result = await studioRpc("studio_story_next_presented", { p_workspace: user.workspaceId, p_actor: user.id, p_series: uuid(input.seriesId),p_style:input.styleId ?? null });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if(input.action==="presentation") {
      const parsed=storyPresentationSchema.safeParse(input.preferences);
      if(!parsed.success || input.confirmed!==true || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<0 || input.expectedRevision>99)
        throw new PanelError("Confira os estilos, a fonte e as vozes antes de salvar a escolha.",400);
      return Response.json(await studioRpc("studio_story_presentation_save",{p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(input.seriesId),p_expected:input.expectedRevision,p_request:uuid(input.requestId),p_preferences:parsed.data,p_confirmed:true}),{headers:{"Cache-Control":"no-store"}});
    }
    if (input.action !== "propose") throw new PanelError("Ação inválida.",400);
    const parsed = storyRequestSchema.safeParse(input.input);
    if (!parsed.success) throw new PanelError("Escolha a criação manual ou automática e de 1 a 6 capítulos. Na criação manual, descreva sua ideia em 30 a 1.000 caracteres.",400);
    return Response.json(await edge({ action: "propose", workspace: user.workspaceId, actor: user.id, request_id: uuid(input.requestId), input: parsed.data }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
