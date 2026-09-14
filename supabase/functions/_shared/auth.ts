import { AppError } from "./error-handler.ts";

export function workerCredential(): string | undefined {
  return Deno.env.get("CONTENT_AI_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

/** Gateway JWT validation alone also accepts anon/user JWTs. Workers are service-only. */
export function requireServiceRole(req: Request, expected = workerCredential()): void {
  if (!expected) throw new AppError("Credencial do worker ausente", 500, "CONFIG_MISSING");
  const token = req.headers.get("authorization");
  if (!token || token !== `Bearer ${expected}`) {
    throw new AppError("Acesso restrito ao worker", 401, "UNAUTHORIZED");
  }
}
