import { appUrl, body, config, db, errorResponse } from "../../../lib/server";
import { assertOrigin, PanelError } from "../../../lib/security.mjs";
export async function GET() {
  try {
    const { data } = await db("system_config", {
      key: "eq.studio_public",
      select: "value",
    });
    return Response.json({ enabled: data[0]?.value?.enabled === true });
  } catch {
    return Response.json({ enabled: false });
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const { data } = await db("system_config", {
      key: "eq.studio_public",
      select: "value",
    });
    if (data[0]?.value?.enabled !== true)
      throw new PanelError(
        "Novos cadastros ainda estão em preparação. O acesso atual continua disponível.",
        409,
      );
    const i = await body(request);
    if (
      typeof i.email !== "string" ||
      i.email.length > 254 ||
      typeof i.password !== "string" ||
      i.password.length < 12 ||
      i.password.length > 200
    )
      throw new PanelError(
        "Informe e-mail e uma senha de pelo menos 12 caracteres.",
      );
    const c = config(),
      r = await fetch(`${c.url}/auth/v1/signup`, {
        method: "POST",
        headers: { apikey: c.anon, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: i.email,
          password: i.password,
          data: { studio_name: String(i.name || "Meu Studio").slice(0, 100) },
        }),
        signal: AbortSignal.timeout(15000),
      });
    if (!r.ok)
      throw new PanelError(
        "Não foi possível criar a conta. Verifique os campos ou aguarde antes de tentar novamente.",
        r.status === 429 ? 429 : 400,
      );
    return Response.json({
      message:
        "Confira seu e-mail para confirmar o cadastro. Depois, entre no Studio.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
