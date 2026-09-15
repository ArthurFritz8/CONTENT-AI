import { cookies } from "next/headers";
import {
  appUrl,
  body,
  config,
  cookieName,
  errorResponse,
  requestUser,
} from "../../../lib/server";
import { assertOrigin, PanelError } from "../../../lib/security.mjs";

export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const input = await body(request);
    if (
      typeof input.email !== "string" ||
      input.email.length > 254 ||
      typeof input.password !== "string" ||
      input.password.length > 200 ||
      !input.password
    )
      throw new PanelError("Informe e-mail e senha.");
    const c = config();
    const res = await fetch(`${c.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: c.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: input.email, password: input.password }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new PanelError(
        res.status === 429
          ? "Muitas tentativas. Aguarde antes de tentar novamente."
          : "Não foi possível entrar com essas credenciais.",
        res.status === 429 ? 429 : 401,
      );
    const session = await res.json();
    await requestUser(session.access_token);
    (await cookies()).set(cookieName, session.access_token, {
      httpOnly: true,
      secure: appUrl().startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: Math.min(session.expires_in || 3600, 3600),
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const jar = await cookies(),
      token = jar.get(cookieName)?.value;
    jar.delete(cookieName);
    if (token) {
      const c = config();
      await fetch(`${c.url}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: c.anon, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
