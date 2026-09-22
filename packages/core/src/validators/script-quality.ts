import { z } from "zod";
import type { ResearchData } from "../schemas/research.ts";
import type { ScriptJson } from "../schemas/script-json.ts";

export const SCRIPT_QUALITY_VERSION = "1.0.0";

export const factCheckConfigSchema = z.object({
  blocked_patterns: z.record(z.array(z.string().trim().min(1).max(160)).max(50))
    .refine(groups => Object.keys(groups).length > 0 && Object.keys(groups).length <= 20,
      "Defina de 1 a 20 grupos de padrões"),
  require_source_per_claim: z.literal(true),
});

export interface QualityFinding {
  code: string;
  path: string;
  severity: "error" | "warning";
  message: string;
}

export interface ScriptQualityReport {
  version: string;
  passed: boolean;
  factual_verification: "requires_human_review";
  findings: QualityFinding[];
}

const normalize = (text: string): string => text.normalize("NFC").trim().replace(/\s+/gu, " ");
const fold = (text: string): string => normalize(text).toLocaleLowerCase("pt-BR")
  .normalize("NFD").replace(/\p{M}/gu, "");
const word = /[\p{L}\p{N}_]/u;

/** Deliberately bounded grammar: literal phrases with optional PostgreSQL word boundaries.
 * Arbitrary regex from config must never run on model-generated text (ReDoS).
 */
function compilePattern(pattern: string): (text: string) => boolean {
  const start = pattern.startsWith("\\m");
  const end = pattern.endsWith("\\M");
  const literal = pattern.slice(start ? 2 : 0, end ? -2 : undefined);
  if (!/^[\p{L}\p{N}\s_'’.,!?%:;\/-]+$/u.test(literal) || !literal.trim()) {
    throw new Error("Padrão inválido: use uma frase literal e, opcionalmente, \\m no início e \\M no fim");
  }
  const needle = fold(literal);
  return (text: string): boolean => {
    const haystack = fold(text);
    let offset = 0;
    while (offset <= haystack.length) {
      const index = haystack.indexOf(needle, offset);
      if (index < 0) return false;
      const before = Array.from(haystack.slice(Math.max(0, index - 2), index)).at(-1) ?? "";
      const after = Array.from(haystack.slice(index + needle.length, index + needle.length + 2))[0] ?? "";
      if ((!start || !word.test(before)) && (!end || !word.test(after))) return true;
      offset = index + needle.length;
    }
    return false;
  };
}

/** Compare exact URLs after standard URL normalization; do not drop query parameters. */
function sourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function createScriptQualityChecker(rawConfig: unknown) {
  const config = factCheckConfigSchema.parse(rawConfig);
  const rules = Object.entries(config.blocked_patterns).flatMap(([group, patterns]) =>
    patterns.map(pattern => ({ group, matches: compilePattern(pattern) })));
  if (!rules.length) throw new Error("Defina ao menos um padrão bloqueado");

  return (script: ScriptJson, research: ResearchData, isCommercial: boolean): ScriptQualityReport => {
    const findings: QualityFinding[] = [];
    const error = (code: string, path: string, message: string) => {
      findings.push({ code, path, severity: "error", message });
    };
    const scenes = [...script.scenes].sort((a, b) => a.order - b.order);
    if (normalize(script.narration.full_text) !== normalize(scenes.map(s => s.narration_text).join(" "))) {
      error("NARRATION_MISMATCH", "narration.full_text", "full_text deve concatenar exatamente as narrações na ordem das cenas");
    }
    for (const [index, source] of script.sources.entries()) {
      const url = sourceUrl(source.source_url);
      if (!url || !research.some(item => normalize(item.claim) === normalize(source.claim) && sourceUrl(item.source_url) === url)) {
        error("SOURCE_NOT_IN_RESEARCH", `sources.${index}`, "Copie o par claim/source_url da pesquisa; não invente ou altere a evidência");
      }
    }

    if (script.disclosures.commercial_content !== isCommercial) {
      error("COMMERCIAL_FLAG_MISMATCH", "disclosures.commercial_content", "A flag comercial deve corresponder ao episódio");
    }
    if (isCommercial) {
      const disclosure = normalize(script.disclosures.commercial_disclosure_text ?? "");
      const targets: Array<[string, string]> = [
        ["scenes.cta.narration_text", scenes.at(-1)?.narration_text ?? ""],
        ["metadata.youtube.description", script.metadata.youtube.description],
        ...(!script.platform_ctas ? [["metadata.tiktok.description", script.metadata.tiktok.description] as [string, string]] : []),
      ];
      for (const [path, text] of targets) {
        if (!disclosure || !normalize(text).includes(disclosure)) {
          error("COMMERCIAL_DISCLOSURE_MISSING", path, "Inclua o texto do disclosure comercial no CTA e nas duas descrições");
        }
      }
    }

    if (script.platform_ctas) {
      const variants = script.platform_ctas;
      if (variants.youtube.commercial !== isCommercial || variants.youtube.narration_text !== scenes.at(-1)?.narration_text) {
        error("PLATFORM_CTA_MISMATCH", "platform_ctas.youtube", "CTA YouTube deve corresponder à narração e ao link validado");
      }
      const organicTexts = [
        ...scenes.filter(s => s.role !== "cta").map(s => s.narration_text),
        ...scenes.map(s => s.visual.description),
        script.metadata.tiktok.title, script.metadata.tiktok.description, ...script.metadata.tiktok.hashtags,
        variants.tiktok.narration_text,
      ];
      if (organicTexts.some(text => /https?:\/\//i.test(text) || variants.organic_blocked_phrases.some(phrase => fold(text).includes(fold(phrase))))) {
        error("ORGANIC_COMMERCIAL_LEAK", "platform_ctas.tiktok", "Remova URLs e frases comerciais do corpo compartilhado, visuais e versão TikTok");
      }
    }
    const publicTexts: Array<[string, string]> = [
      ...(script.platform_ctas ? [["platform_ctas.tiktok.narration_text", script.platform_ctas.tiktok.narration_text] as [string, string]] : []),
      ...scenes.map(s => [`scenes.${s.order}.narration_text`, s.narration_text] as [string, string]),
      ["metadata.youtube.title", script.metadata.youtube.title],
      ["metadata.youtube.description", script.metadata.youtube.description],
      ["metadata.youtube.tags", script.metadata.youtube.tags.join(" ")],
      ["metadata.tiktok.title", script.metadata.tiktok.title],
      ["metadata.tiktok.description", script.metadata.tiktok.description],
      ["metadata.tiktok.hashtags", script.metadata.tiktok.hashtags.join(" ")],
    ];
    for (const [path, text] of publicTexts) {
      const groups = new Set(rules.filter(rule => rule.matches(text)).map(rule => rule.group));
      for (const group of groups) error("BLOCKED_CLAIM", path, `Texto contém padrão bloqueado da categoria ${group}; remova a promessa`);
    }
    for (const scene of scenes) {
      if (scene.highlight_words.some(highlight => !scene.narration_text.includes(highlight))) {
        error("HIGHLIGHT_NOT_NARRATED", `scenes.${scene.order}.highlight_words`, "Destaques devem ser copiados da narração da cena");
      }
    }
    findings.push({ code: "HUMAN_FACT_REVIEW_REQUIRED", path: "sources", severity: "warning",
      message: "Vínculo com a pesquisa não comprova veracidade nem cobertura de todos os fatos narrados; revise fontes, contexto e direitos antes de aprovar" });
    return { version: SCRIPT_QUALITY_VERSION, passed: !findings.some(f => f.severity === "error"),
      factual_verification: "requires_human_review", findings };
  };
}
