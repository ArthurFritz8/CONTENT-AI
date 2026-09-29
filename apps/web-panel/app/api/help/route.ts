import {
  appUrl,
  body,
  config,
  errorResponse,
  requireUser,
} from "../../../lib/server";
import { assertOrigin, PanelError, redact } from "../../../lib/security.mjs";
import { guideFor } from "../../../../../packages/core/src/support/guide";
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser(),
      input = await body(request);
    if (
      typeof input.question !== "string" ||
      input.question.length < 3 ||
      input.question.length > 1500
    )
      throw new PanelError("Escreva uma pergunta de 3 a 1.500 caracteres.");
    const section = String(input.section || "queue").slice(0, 30),
      c = config();
    const question = redact(input.question);
    const fallback = { text: guideFor(section).text, mode: "guide" };
    try {
      const r = await fetch(`${c.url}/functions/v1/studio-help`, {
        method: "POST",
        headers: {
          apikey: c.service,
          Authorization: `Bearer ${c.service}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace: user.workspaceId,
          actor: user.id,
          section,
          question,
        }),
        signal: AbortSignal.timeout(40000),
      });
      return Response.json(r.ok ? await r.json() : fallback);
    } catch {
      return Response.json(fallback);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
