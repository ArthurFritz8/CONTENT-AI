import { workspaceDb } from "../../../lib/workspace";
import {
  appUrl,
  body,
  config,
  errorResponse,
  requireUser,
} from "../../../lib/server";
import { assertOrigin, PanelError, uuid } from "../../../lib/security.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser();
    const input = await body(request);
    const ideaId = uuid(input?.ideaId);
    const own = await workspaceDb(user)("idea_queue", {
      id: `eq.${ideaId}`,
      select: "id",
    });
    if (!own.data.length) throw new PanelError("Pauta não encontrada.", 404);
    const c = config();
    const response = await fetch(`${c.url}/functions/v1/recommend-idea`, {
      method: "POST",
      headers: {
        apikey: c.service,
        Authorization: `Bearer ${c.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idea_id: ideaId }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      console.error("panel.recommendation_failed", { status: response.status });
      throw new PanelError(
        response.status === 429
          ? "A cota gratuita de pesquisa acabou por hoje. Tente amanhã."
          : "Não foi possível analisar esta pauta agora. Tente novamente.",
        response.status === 429 ? 429 : 502,
      );
    }
    const result = await response.json();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
