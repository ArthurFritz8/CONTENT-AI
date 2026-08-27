import type { ScriptJson } from "../schemas/script-json.ts";

/** Stringify determinístico (chaves ordenadas) — mesmo objeto sempre gera o mesmo hash. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 via Web Crypto — mesmo código roda em Deno (Edge Functions) e Node (renderer). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash de idempotência = conteúdo EDITORIAL apenas (ADR-005).
 * Exclui episode_id, prompt_version, music e assets — o mesmo roteiro em outro
 * episódio/versão de prompt/asset deve colidir em episodes.script_hash.
 */
export async function computeScriptHash(script: ScriptJson): Promise<string> {
  const editorial = {
    metadata: script.metadata,
    narration: script.narration,
    scenes: script.scenes.map(
      ({ asset_landscape: _l, asset_portrait: _p, ...scene }) => scene,
    ),
    sources: script.sources,
    disclosures: script.disclosures,
  };
  return sha256Hex(canonicalStringify(editorial));
}
