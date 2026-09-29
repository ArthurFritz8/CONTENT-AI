import {
  appUrl,
  body,
  config,
  errorResponse,
  requireUser,
} from "../../../lib/server";
import { assertOrigin, PanelError, uuid } from "../../../lib/security.mjs";
import { studioRpc, workspaceDb } from "../../../lib/workspace";
import { editorialProfileSchema } from "../../../../../packages/core/src/editorial/profile";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser(),
      input = await body(request);
    if (input.action === "save") {
      const discovery = (
        await workspaceDb(user)("studio_discoveries", {
          id: `eq.${uuid(input.discoveryId)}`,
          select: "id,profile,candidates,expires_at",
        })
      ).data[0];
      if (
        !discovery ||
        Date.parse(discovery.expires_at) <= Date.now() ||
        !Number.isInteger(input.index) ||
        !discovery.candidates[input.index]
      )
        throw new PanelError(
          "Pesquisa expirada. Busque pautas novamente.",
          409,
        );
      const c = discovery.candidates[input.index];
      const briefing =
        `Assunto específico: ${c.title}. Gancho: ${c.hook}. Abordagem: ${c.angle}. Por que agora: ${c.why_now}. Limitação: ${c.limitation}. Fonte para checagem: ${c.source_url}. Vídeo editorial com imagens licenciadas e CTA orgânico, sem alegações além das fontes.`.slice(
          0,
          2000,
        );
      const result = await studioRpc("studio_command", {
        p_workspace: user.workspaceId,
        p_actor: user.id,
        p_request: uuid(input.requestId),
        p_action: "candidate",
        p_payload: {
          briefing,
          discovery_id: discovery.id,
          candidate: c,
          profile: discovery.profile,
        },
      });
      if (result.code !== "created")
        throw new PanelError(
          "Limite da fila ou de adições diárias atingido.",
          409,
        );
      return Response.json(result);
    }
    const profile = editorialProfileSchema.parse(input.profile);
    await studioRpc("studio_command", {
      p_workspace: user.workspaceId,
      p_actor: user.id,
      p_request: uuid(input.requestId),
      p_action: "editorial",
      p_payload: profile,
    });
    const cfg = config();
    const r = await fetch(`${cfg.url}/functions/v1/studio-discover`, {
      method: "POST",
      headers: {
        apikey: cfg.service,
        Authorization: `Bearer ${cfg.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: user.workspaceId,
        actor: user.id,
        profile,
      }),
      signal: AbortSignal.timeout(110000),
    });
    if (!r.ok)
      throw new PanelError(
        r.status === 429
          ? "A cota gratuita de pesquisa foi atingida. Tente amanhã."
          : "A pesquisa não pôde ser concluída. Suas pautas atuais estão preservadas.",
        r.status === 429 ? 429 : 502,
      );
    return Response.json(await r.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
