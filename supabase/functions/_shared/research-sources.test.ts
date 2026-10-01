import { assertEquals } from "jsr:@std/assert@1";
import { briefingReferenceSearch, groundedClaims, mergeResearchSources, sourceDomains } from "./research-sources.ts";
import type { TavilySource } from "./tavily.ts";

const source = (url: string): TavilySource => ({ title: "Fonte", url, content: "Conteúdo factual verificável com mais de vinte caracteres.", score: 0.8 });

Deno.test("busca complementar identifica domínio repetido e remove URL duplicada", () => {
  const initial = [source("https://www.example.com/a"), source("https://example.com/b")];
  assertEquals(sourceDomains(initial).size, 1);
  const merged = mergeResearchSources(initial, [source("https://example.com/b"), source("https://official.test/c")]);
  assertEquals(merged.map((item) => item.url), ["https://www.example.com/a", "https://example.com/b", "https://official.test/c"]);
  assertEquals(sourceDomains(merged).size, 2);
  assertEquals(sourceDomains([source("https://news.example.com.br/a"), source("https://www.example.com.br/b")]).size, 1);
});

Deno.test("pesquisa conserva apenas afirmações com URL exata presente no Tavily", () => {
  const claims = [
    { claim: "Fato com evidência", source_url: "https://example.com/fonte?a=1", confidence: 0.8, query_used: "teste" },
    { claim: "URL parecida mas não retornada", source_url: "https://example.com/fonte?a=2", confidence: 0.8, query_used: "teste" },
    { claim: "Fonte inventada", source_url: "https://inventado.example/fonte", confidence: 0.8, query_used: "teste" },
  ];
  assertEquals(groundedClaims(claims, [source("https://example.com/fonte?a=1")]), [claims[0]]);
});

Deno.test("URL informada na pauta vira busca complementar, nunca evidência automática", () => {
  const briefing = "Muse Charm anunciado pela Meta https://about.fb.com/news/connect/ Verificar dados.";
  assertEquals(briefingReferenceSearch(briefing, [source("https://example.com/a")]),
    "site:about.fb.com Muse Charm anunciado pela Meta  Verificar dados.");
  assertEquals(briefingReferenceSearch(briefing, [source("https://about.fb.com/news/outra/")]), null);
  assertEquals(briefingReferenceSearch("Pauta sem URL", [source("https://example.com/a")]), null);
});
