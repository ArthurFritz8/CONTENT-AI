import { z } from "zod";
import { researchDataSchema, type ResearchData } from "../schemas/research.ts";
import { canonicalStringify } from "./hash-utils.ts";

export const MAX_RESEARCH_EVIDENCE_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const groundingMetadataSchema = z.object({
  webSearchQueries: z.array(z.string().trim().min(1)).min(1).max(100),
  groundingChunks: z.array(z.object({
    web: z.object({ uri: z.string().url(), title: z.string().optional() }).passthrough().optional(),
  }).passthrough()).min(1).max(200),
  groundingSupports: z.array(z.object({
    segment: z.object({
      partIndex: z.number().int().nonnegative().default(0),
      startIndex: z.number().int().nonnegative().default(0),
      endIndex: z.number().int().positive(),
      text: z.string().min(1),
    }).passthrough(),
    groundingChunkIndices: z.array(z.number().int().nonnegative()).min(1).max(200),
  }).passthrough()).min(1).max(500),
}).passthrough();

export const researchEvidenceSchema = z.object({
  version: z.literal("1.0.0"),
  provider: z.literal("gemini_google_search"),
  model: z.string().min(1),
  captured_at: z.string().datetime(),
  parts: z.array(z.string().max(MAX_RESEARCH_EVIDENCE_BYTES).nullable()).min(1).max(100),
  grounding_metadata: groundingMetadataSchema,
}).superRefine((snapshot, ctx) => {
  // Indentation is conservative relative to PostgreSQL's jsonb::text spacing.
  if (encoder.encode(JSON.stringify(snapshot, null, 1)).length > MAX_RESEARCH_EVIDENCE_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Evidência excede 256 KiB" });
  }
});

export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;

function webUrl(value: string): string {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Citação deve ser URL web sem credenciais");
  }
  return url.href;
}

/** Scan JSON string tokens, never match a fake key embedded in another string. */
function claimSpans(text: string): Array<{ claim: string; start: number; end: number }> {
  const spans: Array<{ claim: string; start: number; end: number }> = [];
  let expectingClaim = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const start = i;
    for (i++; i < text.length; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === '"') break;
    }
    const value: unknown = JSON.parse(text.slice(start, i + 1));
    if (expectingClaim) spans.push({ claim: String(value), start: start + 1, end: i });
    expectingClaim = value === "claim" && /^\s*:/.test(text.slice(i + 1));
  }
  return spans;
}

/** Provider citation coverage, not independent fact verification. Throws on ambiguity. */
export function groundedResearch(rawEvidence: unknown): ResearchData {
  const evidence = researchEvidenceSchema.parse(rawEvidence);
  const text = evidence.parts.map(part => part ?? "").join("");
  const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const research = researchDataSchema.parse(JSON.parse(jsonText));
  const spans = claimSpans(text);
  if (spans.length !== research.length || new Set(research.map(item => item.claim)).size !== research.length) {
    throw new Error("Claims duplicados ou localização ambígua no JSON");
  }
  const parts = evidence.parts.map(part => ({ text: part ?? "", bytes: encoder.encode(part ?? "") }));
  const supports = evidence.grounding_metadata.groundingSupports.map(support => {
    const { partIndex, startIndex, endIndex } = support.segment;
    const part = parts[partIndex];
    if (!part || endIndex <= startIndex || endIndex > part.bytes.length ||
      decoder.decode(part.bytes.slice(startIndex, endIndex)) !== support.segment.text) {
      throw new Error("Segmento de grounding não corresponde aos bytes da resposta");
    }
    const urls = support.groundingChunkIndices.map(index => {
      const chunk = evidence.grounding_metadata.groundingChunks[index];
      if (!chunk?.web) throw new Error("Índice de grounding sem fonte web");
      return webUrl(chunk.web.uri);
    });
    return { partIndex, startIndex, endIndex, urls };
  });
  return research.map((item, index) => {
    const span = spans[index]!;
    if (span.claim !== item.claim) throw new Error("Claim não corresponde à localização no JSON");
    let partStart = 0;
    const partIndex = parts.findIndex(part => {
      if (span.start >= partStart && span.end <= partStart + part.text.length) return true;
      partStart += part.text.length;
      return false;
    });
    if (partIndex < 0) throw new Error("Claim atravessa partes e não possui suporte inequívoco");
    const part = parts[partIndex]!;
    const start = encoder.encode(part.text.slice(0, span.start - partStart)).length;
    const end = encoder.encode(part.text.slice(0, span.end - partStart)).length;
    const urls = supports.filter(s => s.partIndex === partIndex && s.startIndex <= start && s.endIndex >= end)
      .flatMap(s => s.urls);
    if (!urls.length) throw new Error(`Claim ${index + 1} sem cobertura integral de grounding`);
    let suppliedUrl: string | null = null;
    try { suppliedUrl = webUrl(item.source_url); } catch { /* never trust model URLs */ }
    return { ...item, source_url: suppliedUrl && urls.includes(suppliedUrl) ? suppliedUrl : urls[0]! };
  });
}

export function researchMatchesEvidence(research: ResearchData, evidence: unknown): boolean {
  try { return canonicalStringify(research) === canonicalStringify(groundedResearch(evidence)); }
  catch { return false; }
}
