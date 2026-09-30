import type { TavilySource } from "./tavily.ts";

export function sourceDomains(sources: readonly Pick<TavilySource, "url">[]): Set<string> {
  const twoLevelSuffixes = new Set(["com.br", "org.br", "gov.br", "net.br", "com.au", "co.uk", "gov.uk", "ac.uk"]);
  return new Set(sources.map((source) => {
    const hostname = new URL(source.url).hostname.replace(/^www\./i, "");
    const labels = hostname.split(".");
    if (labels.length < 3) return hostname;
    const suffix = labels.slice(-2).join(".");
    return labels.slice(-(twoLevelSuffixes.has(suffix) ? 3 : 2)).join(".");
  }));
}

export function mergeResearchSources(primary: TavilySource[], complementary: TavilySource[]): TavilySource[] {
  const seen = new Set<string>();
  const merged: TavilySource[] = [];
  for (const source of [...primary, ...complementary]) {
    const normalized = new URL(source.url).href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(source);
    if (merged.length === 8) break;
  }
  return merged;
}
