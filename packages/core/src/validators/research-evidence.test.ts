import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { makeResearchEvidence } from "../testing/research-fixture.ts";
import { groundedResearch, researchMatchesEvidence, MAX_RESEARCH_EVIDENCE_BYTES } from "./research-evidence.ts";

const research = [
  { claim: "Ação útil 🔋 com bateria de 12 horas", source_url: "https://example.com/specs", confidence: 0.9, query_used: "bateria" },
  { claim: 'Tem modo "eco" e conexão USB', source_url: "https://example.com/manual", confidence: 0.8, query_used: "modo eco" },
];

test("preserva vínculo UTF-8, emojis e aspas escapadas entre claim e citação", () => {
  deepStrictEqual(groundedResearch(makeResearchEvidence(research)), research);
});

test("deriva URL de citação real, sem confiar em URL inventada pelo modelo ou seguir redirects", () => {
  const evidence = makeResearchEvidence(research);
  const providerUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/fixture";
  evidence.grounding_metadata.groundingChunks[0]!.web!.uri = providerUrl;
  strictEqual(groundedResearch(evidence)[0]!.source_url, providerUrl);
  strictEqual(JSON.parse(evidence.parts[0]!)[0].source_url, research[0]!.source_url);
});

test("prefere a fonte indicada pelo modelo somente quando pertence aos chunks citados", () => {
  const evidence = makeResearchEvidence(research);
  evidence.grounding_metadata.groundingSupports[0]!.groundingChunkIndices = [1, 0];
  deepStrictEqual(groundedResearch(evidence), research);
});

test("metadados ausentes, chunks inválidos, protocolo ativo e texto desalinhado falham", () => {
  const mutations = [
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.webSearchQueries = []; },
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.groundingSupports = []; },
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.groundingSupports[0]!.groundingChunkIndices = [99]; },
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.groundingChunks[0]!.web!.uri = "javascript:alert(1)"; },
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.groundingSupports[0]!.segment.text = "Outro texto"; },
    (e: ReturnType<typeof makeResearchEvidence>) => { e.grounding_metadata.groundingSupports[0]!.segment.endIndex = 999999; },
  ];
  for (const mutate of mutations) {
    const evidence = makeResearchEvidence(research);
    mutate(evidence);
    throws(() => groundedResearch(evidence));
  }
  throws(() => groundedResearch(null));
});

test("citação de parte de um claim não aprova o claim completo", () => {
  const evidence = makeResearchEvidence(research);
  const support = evidence.grounding_metadata.groundingSupports[0]!;
  support.segment.text = '{"claim":"Ação';
  support.segment.endIndex = support.segment.startIndex + new TextEncoder().encode(support.segment.text).length;
  throws(() => groundedResearch(evidence));
});

test("offsets em caracteres não podem ser confundidos com bytes UTF-8", () => {
  const evidence = makeResearchEvidence(research);
  const support = evidence.grounding_metadata.groundingSupports[1]!;
  support.segment.startIndex = evidence.parts[0]!.indexOf(support.segment.text);
  support.segment.endIndex = support.segment.startIndex + support.segment.text.length;
  throws(() => groundedResearch(evidence));
});

test("preserva índices de partes inclusive slots não textuais e offsets locais", () => {
  const evidence = makeResearchEvidence(research);
  const first = JSON.stringify(research[0]);
  const second = JSON.stringify(research[1]);
  evidence.parts = [null, `[${first},`, `${second}]`];
  const supports = evidence.grounding_metadata.groundingSupports;
  supports[0]!.segment.partIndex = 1;
  supports[1]!.segment = { partIndex: 2, startIndex: 0,
    endIndex: new TextEncoder().encode(second).length, text: second };
  deepStrictEqual(groundedResearch(evidence), research);
  supports[1]!.segment.partIndex = 0;
  throws(() => groundedResearch(evidence));
});

test("não confunde propriedade claim com texto escapado dentro de outro campo", () => {
  const special = [{ ...research[0]!, query_used: 'busca "claim": "falsa"' }];
  deepStrictEqual(groundedResearch(makeResearchEvidence(special)), special);
});

test("evidência excessiva é rejeitada e nunca truncada", () => {
  const evidence = makeResearchEvidence(research);
  evidence.grounding_metadata.searchEntryPoint = { renderedContent: "x".repeat(MAX_RESEARCH_EVIDENCE_BYTES) };
  throws(() => groundedResearch(evidence));
});

test("pesquisa editada, incompleta ou com confiança alterada não reutiliza evidência", () => {
  const evidence = makeResearchEvidence(research);
  strictEqual(researchMatchesEvidence(research, evidence), true);
  strictEqual(researchMatchesEvidence([{ ...research[0]!, confidence: 0.5 }, research[1]!], evidence), false);
  strictEqual(researchMatchesEvidence(research.slice(1), evidence), false);
  strictEqual(researchMatchesEvidence([{ ...research[0]!, claim: "Outra afirmação" }, research[1]!], evidence), false);
});
