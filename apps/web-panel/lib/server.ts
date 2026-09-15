import { cookies } from "next/headers";
import { PanelError, allowedUser, redact } from "./security.mjs";

export const cookieName = "fritz_session";
export function config() {
  const {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
    WEB_PANEL_ALLOWED_USER_IDS: users,
  } = process.env;
  if (!url || !anon || !service || !users)
    throw new PanelError(
      "O administrador ainda precisa configurar a conexão e o acesso do painel.",
      503,
    );
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new PanelError("Conexão inválida.", 503);
  return { url: parsed.origin, anon, service, users };
}
export function appUrl() {
  return process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "";
}
export async function requestUser(token: string) {
  const c = config();
  const res = await fetch(`${c.url}/auth/v1/user`, {
    headers: { apikey: c.anon, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok)
    throw new PanelError("Sua sessão expirou. Entre novamente.", 401);
  const user = await res.json();
  if (!allowedUser(user.id, c.users))
    throw new PanelError("Esta conta não tem acesso ao painel.", 403);
  return { id: user.id as string, email: user.email as string };
}
export async function requireUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new PanelError("Entre para acessar o painel.", 401);
  return requestUser(token);
}
export async function db(
  table: string,
  params: Record<string, string> = {},
  options: RequestInit = {},
) {
  const c = config();
  const res = await fetch(
    `${c.url}/rest/v1/${table}?${new URLSearchParams(params)}`,
    {
      ...options,
      headers: {
        apikey: c.service,
        Authorization: `Bearer ${c.service}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
        ...options.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) {
    // Do not forward database details, SQL, request bodies or credentials to the client.
    console.error("panel.database", { table, status: res.status });
    throw new PanelError(
      "Não foi possível consultar ou salvar os dados. Verifique a conexão e as migrações do painel.",
      502,
    );
  }
  const data = options.method === "HEAD" ? [] : await res.json();
  const raw = res.headers.get("content-range")?.split("/")[1];
  return { data, total: raw && raw !== "*" ? Number(raw) : null };
}
export function safeErrorText(value: unknown) {
  return redact(
    value,
    Object.entries(process.env)
      .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key))
      .map(([, v]) => v || ""),
  );
}
export async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new PanelError("Envie JSON.", 415);
  if (Number(request.headers.get("content-length") || 0) > 12000)
    throw new PanelError("Requisição muito grande.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PanelError("Dados ausentes.");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12000) {
      await reader.cancel();
      throw new PanelError("Requisição muito grande.", 413);
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new PanelError("JSON inválido.");
  }
}
export function errorResponse(error: unknown) {
  const known = error instanceof PanelError;
  if (!known)
    console.error(
      "panel.request_failed",
      error instanceof Error ? error.name : "Unknown",
    );
  return Response.json(
    { error: known ? error.message : "Serviço indisponível. Tente novamente." },
    {
      status: known ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
