import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { buildScriptPrompt } from "./script-prompt.ts";
import { EDITORIAL_STYLES } from "../schemas/script-json.ts";

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

test("inclui o catálogo completo de estilos editoriais e pede variedade (ADR-033)", () => {
  const prompt = buildScriptPrompt(baseInput);
  ok(prompt.includes("editorial_style"));
  for (const style of EDITORIAL_STYLES) {
    ok(prompt.includes(style), `catálogo deve mencionar ${style}`);
  }
  ok(prompt.toLowerCase().includes("varie"));
});

test("informa ao modelo quais plataformas têm link sem expor URLs", () => {
  const prompt = buildScriptPrompt({
    ...baseInput,
    isCommercial: true,
    commercialPlatforms: ["youtube"],
  });
  ok(prompt.includes("Plataformas com link validado: youtube"));
  ok(prompt.includes("somente o link pertencente àquela plataforma"));
});
