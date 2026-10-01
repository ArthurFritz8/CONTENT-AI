import type { PexelsPhoto } from "./pexels.ts";

const namedDevices = [
  "apple", "iphone", "ipad", "macbook", "dji", "samsung", "galaxy",
  "sony", "nintendo", "tesla", "lenovo", "asus", "acer", "dell",
] as const;
const deviceTypes = [
  "camera", "robot", "laptop", "computer", "monitor", "hub", "charger",
  "keyboard", "headphones", "earbuds", "tablet", "console", "drone",
] as const;
const genericWords = new Set([
  "person", "people", "woman", "man", "holding", "close", "background",
  "modern", "photo", "image", "indoor", "outdoor", "concept", "studio",
  "small", "with", "from", "showing", "illustration", "view",
]);
const unrelatedContexts = [
  ["house", "home", "real estate", "moving"],
  ["dental", "dentist", "clinic"],
  ["health", "medical", "hospital"],
  ["wedding", "party", "festive", "new year's eve"],
] as const;

function words(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase("en").match(/[a-z0-9]{4,}/g) ?? [])
    .filter((term) => !genericWords.has(term)));
}

function relevance(alt: string, queryWords: Set<string>): number {
  const altWords = [...words(alt)];
  return [...queryWords].filter((term) => altWords.some((word) =>
    word === term || (term.length >= 5 && word.includes(term)) || (word.length >= 5 && term.includes(word)))).length;
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
      const unrelated = unrelatedContexts.some((group) =>
        group.some((term) => alt.includes(term)) &&
        !group.some((term) => requested.includes(term))
      );
      const staleYear = (alt.match(/\b20\d{2}\b/g) ?? []).some((year) =>
        Number(year) < new Date().getUTCFullYear() && !requested.includes(year));
      return !otherBrand && !otherDevice && !unrelated && !staleYear;
    })
    .map((photo, index) => ({
      photo,
      index,
      relevance: relevance(photo.alt, queryWords),
    }))
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .slice(0, Math.max(1, Math.min(3, count)))
    .map(({ photo }) => photo);
}
