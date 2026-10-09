import { appUrl, body, config, errorResponse, requireUser } from "../../../lib/server";
import { assertOrigin, PanelError, uuid } from "../../../lib/security.mjs";
import { studioRpc } from "../../../lib/workspace";
import { storyRequestSchema } from "../../../../../packages/core/src/stories/schema";
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
export async function GET() {
  try {
    const user = await requireUser();
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
    const user = await requireUser(), input = await body(request);
    if (["retry","archive"].includes(input.action)) {
      return Response.json(await studioRpc("studio_story_manage", { p_workspace:user.workspaceId,p_actor:user.id,p_series:uuid(input.seriesId),p_action:input.action }), { headers:{"Cache-Control":"no-store"} });
    }
    if (input.action === "next") {
      const result = await studioRpc("studio_story_next", { p_workspace: user.workspaceId, p_actor: user.id, p_series: uuid(input.seriesId) });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (input.action !== "propose") throw new PanelError("Ação inválida.",400);
    const parsed = storyRequestSchema.safeParse(input.input);
    if (!parsed.success) throw new PanelError("Escolha a criação manual ou automática e de 1 a 6 capítulos. Na criação manual, descreva sua ideia em 30 a 1.000 caracteres.",400);
    return Response.json(await edge({ action: "propose", workspace: user.workspaceId, actor: user.id, request_id: uuid(input.requestId), input: parsed.data }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
