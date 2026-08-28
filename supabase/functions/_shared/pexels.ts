// Cliente Pexels (free 200 req/hora). Hotlink direto das URLs do CDN —
// não re-upload para Storage (poupa o 1GB free tier, ADR-009).

import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";

export interface PexelsPhoto {
  landscape_url: string;
  portrait_url: string;
  author: string;
  pexels_url: string;
}

export async function searchPexelsPhoto(query: string): Promise<PexelsPhoto | null> {
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  if (!apiKey) throw new AppError("PEXELS_API_KEY ausente no ambiente", 500, "CONFIG_MISSING");

  return await retryWithBackoff(
    async () => {
      const url = new URL("https://api.pexels.com/v1/search");
      url.searchParams.set("query", query);
      url.searchParams.set("per_page", "1");
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      if (!res.ok) {
        throw new AppError(
          `Pexels falhou (${res.status})`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "PEXELS_CALL_FAILED",
        );
      }
      const json = await res.json();
      const photo = json?.photos?.[0];
      if (!photo) return null;
      return {
        landscape_url: photo.src.landscape,
        portrait_url: photo.src.portrait,
        author: photo.photographer ?? "unknown",
        pexels_url: photo.url,
      };
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}
