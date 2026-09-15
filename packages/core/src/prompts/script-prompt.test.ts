import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { buildScriptPrompt } from "./script-prompt.ts";

const baseInput = {
  briefing: "Organizador de cabos para mesa de trabalho.",
  researchData: [
    { claim: "Reduz emaranhado de cabos", source_url: "https://example.com/fonte", confidence: 0.9, query_used: "organizador de cabos" },
  ],
  isCommercial: false,
};

test("sem spokesmodel configurado, instrui presenter sempre false", () => {
  const prompt = buildScriptPrompt(baseInput);
  ok(prompt.includes("presenter"));
  ok(prompt.toLowerCase().includes("não há personagem fixo"));
});

test("com spokesmodel habilitado, inclui descrição do personagem e o limite de cenas", () => {
  const prompt = buildScriptPrompt({
    ...baseInput,
    spokesmodel: { characterDescription: "Mulher, 30 anos, cabelo cacheado castanho, jaleco casual", maxScenesPerEpisode: 1 },
  });
  ok(prompt.includes("Mulher, 30 anos, cabelo cacheado castanho, jaleco casual"));
  ok(prompt.includes("no máximo 1 cena"));
  strictEqual(prompt.toLowerCase().includes("não há personagem fixo"), false);
});
