import type { ResearchData } from "../schemas/research.ts";
import type { ResearchEvidence } from "../validators/research-evidence.ts";

/** Provider-shaped fixture; no network or generated claims. */
export function makeResearchEvidence(research: ResearchData): ResearchEvidence {
  const text = JSON.stringify(research);
  const encoder = new TextEncoder();
  let offset = 0;
  return {
    version: "1.0.0", provider: "gemini_google_search", model: "gemini-2.5-flash",
    captured_at: "2026-09-11T00:00:00.000Z", parts: [text],
    grounding_metadata: {
      webSearchQueries: research.map(item => item.query_used),
      groundingChunks: research.map(item => ({ web: { uri: item.source_url, title: "Fixture" } })),
      groundingSupports: research.map((item, index) => {
        const segment = JSON.stringify(item);
        const start = text.indexOf(segment, offset);
        offset = start + segment.length;
        return { segment: { partIndex: 0, startIndex: encoder.encode(text.slice(0, start)).length,
          endIndex: encoder.encode(text.slice(0, offset)).length, text: segment }, groundingChunkIndices: [index] };
      }),
      searchEntryPoint: { renderedContent: "<div>Provider search suggestions fixture</div>" },
    },
  };
}
