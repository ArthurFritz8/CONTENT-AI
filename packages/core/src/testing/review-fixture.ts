import { makeValidScript } from "./script-fixture.ts";
import { makeResearchEvidence } from "./research-fixture.ts";

export function makeReviewSnapshot() {
  const script = makeValidScript();
  const image = { url: "https://example.com/image.png", license: "own" as const, source: "manual" as const };
  for (const scene of script.scenes) { scene.asset_landscape = image; scene.asset_portrait = image; }
  const research = script.sources.map(source => ({ ...source, confidence: 0.9, query_used: "gadget" }));
  return { episode: { id: script.episode_id, script_json: script, render_url: "https://example.com/portrait.mp4",
    research_data: research, research_evidence: makeResearchEvidence(research), product_compliance: { commercial_content: false },
    metadata: { render_outputs: { portrait: "https://example.com/portrait.mp4", landscape: "https://example.com/landscape.mp4" } } },
    assets: [{ type: "image", ...image, author: "Fixture author", metadata: { scene_order: 0 } }],
    fact_check: { blocked_patterns: { medical: ["\\mcura\\M"] }, require_source_per_claim: true },
  };
}
