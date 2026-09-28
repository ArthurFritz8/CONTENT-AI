import { assertEquals } from "jsr:@std/assert@1";
import { supportedRecommendations } from "./idea-recommendations.ts";
import { concreteEditorialHeadline, visualProductSignal } from "../discover-trends/handler.ts";

const sources = [{
  title: "Anker MagGo UFO 3-in-1 review",
  url: "https://example.com/anker-maggio",
  content: "The Anker MagGo UFO 3-in-1 is a folding wireless charging stand for phones, earbuds and watches.",
  score: 0.9,
}];
const recommendation = {
  product_name: "Anker MagGo UFO 3-in-1",
  hook: "Uma base dobrável para três aparelhos em uma mochila.",
  problem: "Carregadores separados ocupam espaço na mochila.",
  limitation: "Compatibilidade deve ser verificada para cada aparelho.",
  why_now: "Uma análise recente descreve o formato dobrável.",
  source_url: sources[0].url,
};

Deno.test("only recommendations with an exact supplied source and named product survive", () => {
  assertEquals(supportedRecommendations([
    recommendation,
    { ...recommendation, product_name: "Invented Miracle X99" },
    { ...recommendation, source_url: "https://fabricated.example/product" },
  ], sources), [recommendation]);
});

Deno.test("generic roundups are not treated as concrete product headlines", () => {
  assertEquals(concreteEditorialHeadline("10 invenções inusitadas da CES 2026"), false);
  assertEquals(concreteEditorialHeadline("Tendências de produtos eletrônicos para 2026"), false);
  assertEquals(concreteEditorialHeadline("Anker MagGo UFO 3-in-1 review"), true);
  assertEquals(visualProductSignal("Amazon Basics AA Alkaline Batteries 20 Pack"), false);
  assertEquals(visualProductSignal("Luminária articulada compacta"), true);
});
