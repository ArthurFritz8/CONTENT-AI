import type { PexelsPhoto } from "./pexels.ts";

const namedDevices = [
  "apple", "iphone", "ipad", "macbook", "dji", "samsung", "galaxy",
  "sony", "nintendo", "tesla", "lenovo", "asus", "acer", "dell",
] as const;
const deviceTypes = [
  "camera", "robot", "laptop", "computer", "monitor", "hub", "charger",
  "keyboard", "headphones", "earbuds", "tablet", "console", "drone",
] as const;

function words(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en").match(/[a-z0-9]{4,}/g) ?? []);
}

/** Stock is context, never evidence that a photographed device is the narrated product. */
export function selectPexelsPhotos(
  candidates: PexelsPhoto[],
  query: string,
  narration: string,
  usedUrls: ReadonlySet<string>,
  count = 3,
): PexelsPhoto[] {
  const queryWords = words(query);
  const mentioned = narration.toLocaleLowerCase("pt-BR");
  const requested = `${query} ${narration}`.toLocaleLowerCase("en");
  return candidates
    .filter((photo) => {
      if (usedUrls.has(photo.pexels_url)) return false;
      const alt = photo.alt.toLocaleLowerCase("en");
      const otherBrand = namedDevices.some((name) =>
        new RegExp(`\\b${name}\\b`, "i").test(alt) &&
        !new RegExp(`\\b${name}\\b`, "i").test(mentioned)
      );
      const otherDevice = deviceTypes.some((name) =>
        new RegExp(`\\b${name}\\b`, "i").test(alt) &&
        !new RegExp(`\\b${name}\\b`, "i").test(requested)
      );
      return !otherBrand && !otherDevice;
    })
    .map((photo, index) => ({
      photo,
      index,
      relevance: [...words(photo.alt)].filter((word) => queryWords.has(word)).length,
    }))
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, Math.max(1, Math.min(3, count)))
    .map(({ photo }) => photo);
}
