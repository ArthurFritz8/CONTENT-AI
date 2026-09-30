import { config } from "./server";
import { mediaUrl } from "./security.mjs";
/** Caller must first authorize the episode. Signed links are short-lived capabilities. */
export async function previewUrl(raw: unknown, episode: string) {
  const c = config();
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (
      url.origin !== c.url ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    const prefix = `/storage/v1/object/authenticated/studio-private/episodes/${episode}/`;
    if (!url.pathname.startsWith(prefix)) return mediaUrl(raw, c.url);
    const path = url.pathname.slice("/storage/v1/object/authenticated/".length);
    const r = await fetch(`${c.url}/storage/v1/object/sign/${path}`, {
      method: "POST",
      headers: {
        apikey: c.service,
        Authorization: `Bearer ${c.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 600 }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.signedURL ? `${c.url}/storage/v1${d.signedURL}` : null;
  } catch {
    return null;
  }
}
