import { test } from "node:test";
import { strictEqual, ok, throws } from "node:assert";
import { makeValidScript } from "../testing/script-fixture.ts";
import { createScriptQualityChecker } from "./script-quality.ts";

const config = { blocked_patterns: { medical: ["\\mcura\\M"], absolute: ["único no mercado"] }, require_source_per_claim: true };
const check = createScriptQualityChecker(config);
const research = [{ claim: "Afirmação X", source_url: "https://example.com/fonte", confidence: 0.9, query_used: "teste" }];

test("QA válido mantém revisão humana obrigatória e não inventa score factual", () => {
  const report = check(makeValidScript(), research, false);
  strictEqual(report.passed, true);
  strictEqual(report.factual_verification, "requires_human_review");
  ok(report.findings.some(f => f.code === "HUMAN_FACT_REVIEW_REQUIRED"));
});

test("narração segue order mesmo quando array está invertido; whitespace não cria falso erro", () => {
  const script = makeValidScript();
  script.scenes.reverse();
  script.narration.full_text = " Narração da cena 0\nNarração da cena 1  Narração da cena 2 ";
  strictEqual(check(script, research, false).passed, true);
  script.narration.full_text = "Outro roteiro";
  ok(check(script, research, false).findings.some(f => f.code === "NARRATION_MISMATCH"));
});

test("fonte deve preservar o par claim/URL, inclusive query e fragmento", () => {
  for (const source of [
    { claim: "Outra afirmação", source_url: research[0]!.source_url },
    { claim: "Afirmação X", source_url: "https://inventada.test/fonte" },
    { claim: "Afirmação X", source_url: "https://example.com/fonte?produto=outro" },
    { claim: "Afirmação X", source_url: "https://example.com/fonte#outra-secao" },
  ]) {
    const script = makeValidScript();
    script.sources = [source];
    strictEqual(check(script, research, false).passed, false);
  }
});

test("URLs não web e com credenciais são rejeitadas mesmo quando constam na pesquisa", () => {
  for (const url of ["javascript:alert(1)", "https://user:pass@example.com/fonte"]) {
    const script = makeValidScript();
    script.sources[0]!.source_url = url;
    strictEqual(check(script, [{ ...research[0]!, source_url: url }], false).passed, false);
  }
});

test("URL normalizada e Unicode NFC preservam evidência sem comparação semântica inventada", () => {
  const script = makeValidScript();
  script.sources[0]!.claim = "Afirmaça\u0303o X";
  script.sources[0]!.source_url = "https://EXAMPLE.com:443/fonte";
  strictEqual(check(script, research, false).passed, true);
});

test("boundaries PostgreSQL respeitam palavras Unicode e não confundem procura com cura", () => {
  for (const [text, blocked] of [["Procura um gadget?", false], ["CURA!", true], ["Açúcarcura", false], ["curaçúcar", false], ["Cura em um dia", true]] as const) {
    const script = makeValidScript();
    script.metadata.youtube.title = text;
    strictEqual(check(script, research, false).findings.some(f => f.code === "BLOCKED_CLAIM"), blocked, text);
  }
});

test("padrões também verificam descrições, tags e hashtags; ignoram caixa e acentos", () => {
  const script = makeValidScript();
  script.metadata.youtube.description = "É UNICO NO MERCADO!";
  script.metadata.tiktok.hashtags = ["#cura"];
  const report = check(script, research, false);
  ok(report.findings.some(f => f.path === "metadata.youtube.description" && f.code === "BLOCKED_CLAIM"));
  ok(report.findings.some(f => f.path === "metadata.tiktok.hashtags" && f.code === "BLOCKED_CLAIM"));
});

test("configuração inválida ou regex potencialmente explosiva falha ao compilar", () => {
  for (const input of [null, {}, { ...config, require_source_per_claim: false },
    { ...config, blocked_patterns: {} }, { ...config, blocked_patterns: { medical: [] } },
    { ...config, blocked_patterns: { medical: ["(a+)+$"] } },
    { ...config, blocked_patterns: { medical: ["\\ycura\\y"] } }]) {
    throws(() => createScriptQualityChecker(input));
  }
});

test("disclosure comercial exige episódio, CTA e ambas as descrições coerentes", () => {
  const script = makeValidScript();
  strictEqual(check(script, research, true).passed, false);
  script.disclosures.commercial_content = true;
  script.disclosures.commercial_disclosure_text = "Este vídeo contém link de afiliado.";
  strictEqual(check(script, research, true).passed, false);
  script.scenes[2]!.narration_text += ` ${script.disclosures.commercial_disclosure_text}`;
  script.narration.full_text = script.scenes.map(s => s.narration_text).join(" ");
  script.metadata.youtube.description += ` ${script.disclosures.commercial_disclosure_text}`;
  script.metadata.tiktok.description += ` ${script.disclosures.commercial_disclosure_text}`;
  strictEqual(check(script, research, true).passed, true);
  strictEqual(check(script, research, false).passed, false);
});

test("destaque ausente na narração é reprovado", () => {
  const script = makeValidScript();
  script.scenes[0]!.highlight_words = ["inexistente"];
  ok(check(script, research, false).findings.some(f => f.code === "HIGHLIGHT_NOT_NARRATED"));
});
