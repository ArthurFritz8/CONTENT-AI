import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./error-handler.ts";

/** Client service_role — bypassa RLS; usar somente dentro de Edge Functions. */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new AppError(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente",
      500,
      "CONFIG_MISSING",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Lê uma chave de system_config; retorna fallback se ausente (config-driven, ADR-001). */
export async function getSystemConfig<T>(
  db: SupabaseClient,
  key: string,
  fallback: T,
): Promise<T> {
  const { data, error } = await db
    .from("system_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return fallback;
  return data.value as T;
}
