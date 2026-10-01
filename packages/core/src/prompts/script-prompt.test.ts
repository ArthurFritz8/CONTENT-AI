import { test } from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(prompt.includes("presenter"));
  assert.ok(prompt.toLowerCase().includes("não há personagem fixo"));
});

test("com spokesmodel habilitado, inclui descrição do personagem e o limite de cenas", () => {
  const prompt = buildScriptPrompt({
    ...baseInput,
    spokesmodel: { characterDescription: "Mulher, 30 anos, cabelo cacheado castanho, jaleco casual", maxScenesPerEpisode: 1 },
  });
  assert.ok(prompt.includes("Mulher, 30 anos, cabelo cacheado castanho, jaleco casual"));
  assert.ok(prompt.includes("no máximo 1 cena"));
  assert.equal(prompt.toLowerCase().includes("não há personagem fixo"), false);
});

test("inclui o catálogo completo de estilos editoriais e pede variedade (ADR-033)", () => {
  const prompt = buildScriptPrompt(baseInput);
  assert.ok(prompt.includes("editorial_style"));
  for (const style of EDITORIAL_STYLES) assert.ok(prompt.includes(style), `catálogo deve mencionar ${style}`);
  assert.ok(prompt.toLowerCase().includes("varie"));
});

test("informa ao modelo quais plataformas têm link sem expor URLs", () => {
  const prompt = buildScriptPrompt({
    ...baseInput,
    isCommercial: true,
    commercialPlatforms: ["youtube"],
  });
  assert.ok(prompt.includes("Plataformas com link validado: youtube"));
  assert.ok(prompt.includes("somente o link pertencente àquela plataforma"));
});

test("chosen trend product keeps the script centered on one item", () => {
  const prompt = buildScriptPrompt({
    briefing: "Produto específico: Anker MagGo UFO 3-in-1.",
    productName: "Anker MagGo UFO 3-in-1",
    researchData: [], isCommercial: false,
  });
  assert.match(prompt, /PRODUTO CENTRAL OBRIGATÓRIO: Anker MagGo UFO 3-in-1/);
  assert.match(prompt, /não transforme a pauta em lista de gadgets/);
});

test("reportagem não deve virar confirmação atribuída ao fabricante", () => {
  const prompt = buildScriptPrompt(baseInput);
  assert.match(prompt, /Diferencie anúncio da fabricante de relato de imprensa/);
  assert.match(prompt, /Não diga "confirmado pela empresa"/);
});

test("busca stock não deve simular foto do produto narrado", () => {
  const prompt = buildScriptPrompt(baseInput);
  assert.match(prompt, /não peça close-up de chaveiros eletrônicos/);
  assert.match(prompt, /Só mostre o produto real quando existir imagem autorizada/);
});
