import { AppError } from "./error-handler.ts";

export function validateAssetHost(raw: string, allowedHosts: string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !allowedHosts.includes(url.hostname) || url.hostname === "localhost" ||
    /^[\d.]+$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new AppError("Host de imagem não autorizado", 422, "ASSET_HOST_DENIED");
  }
  return url;
}

export async function downloadImage(raw: string, maxBytes: number, allowedHosts: string[]): Promise<{bytes: Uint8Array; mimeType: string}> {
  const url = validateAssetHost(raw, allowedHosts);
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok || !res.body) throw new AppError("Imagem indisponível", 502, "AFFILIATE_IMAGE_FAILED");
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    await res.body.cancel();
    throw new AppError("Formato de imagem inválido", 422, "AFFILIATE_IMAGE_INVALID");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new AppError("Imagem excede limite", 422, "AFFILIATE_IMAGE_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, mimeType };
}
