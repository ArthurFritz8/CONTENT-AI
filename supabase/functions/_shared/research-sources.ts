import type { TavilySource } from "./tavily.ts";
import type { ResearchData } from "../../../packages/core/src/schemas/research.ts";

/** Keep only claims citing an exact URL returned by the search provider. */
export function groundedClaims(claims: ResearchData, sources: readonly Pick<TavilySource, "url">[]): ResearchData {
  const urls = new Set(sources.map((source) => new URL(source.url).href));
  return claims.filter((claim) => {
    try {
      const url = new URL(claim.source_url);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && urls.has(url.href);
    } catch {
      return false;
    }
  });
}

/** A briefing URL is a search hint, not evidence until Tavily returns it. */
export function briefingReferenceSearch(briefing: string, sources: readonly Pick<TavilySource, "url">[]): string | null {
  const raw = briefing.match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,;]+$/, "");
  if (!raw) return null;
  let host: string;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    host = url.hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
  if (sources.some((source) => new URL(source.url).hostname.replace(/^www\./i, "") === host)) return null;
  const topic = briefing.replace(raw, "").replace(/https?:\/\/[^\s)]+/gi, "").slice(0, 110).trim();
  return `site:${host} ${topic}`.slice(0, 200);
}

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
