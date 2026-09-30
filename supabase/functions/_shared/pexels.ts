// Cliente Pexels (free 200 req/hora). Hotlink direto das URLs do CDN —
// não re-upload para Storage (poupa o 1GB free tier, ADR-009).

import { AppError, isTransientHttpStatus, retryWithBackoff } from "./error-handler.ts";
import { z } from "zod";

const responseSchema = z.object({ photos: z.array(z.object({
  id: z.number().int(),
  url: z.string().url(),
  photographer: z.string().optional(),
  alt: z.string().nullish(),
  src: z.object({ landscape: z.string().url(), portrait: z.string().url() }),
})).default([]) });

export interface PexelsPhoto {
  id: number;
  landscape_url: string;
  portrait_url: string;
  author: string;
  pexels_url: string;
  alt: string;
}

export async function searchPexelsPhotos(query: string): Promise<PexelsPhoto[]> {
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  if (!apiKey) throw new AppError("PEXELS_API_KEY ausente no ambiente", 500, "CONFIG_MISSING");

  return await retryWithBackoff(
    async () => {
      const url = new URL("https://api.pexels.com/v1/search");
      url.searchParams.set("query", query);
      url.searchParams.set("per_page", "12");
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      if (!res.ok) {
        throw new AppError(
          `Pexels falhou (${res.status})`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "PEXELS_CALL_FAILED",
        );
      }
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) throw new AppError("Pexels retornou fotos inválidas", 502, "PEXELS_INVALID_RESPONSE");
      return parsed.data.photos
        .map((photo) => ({
          id: photo.id,
          landscape_url: photo.src.landscape,
          portrait_url: photo.src.portrait,
          author: photo.photographer ?? "unknown",
          pexels_url: photo.url,
          alt: photo.alt ?? "",
        }));
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}
