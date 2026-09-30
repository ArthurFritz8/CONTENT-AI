import { assertEquals } from "jsr:@std/assert@1";
import { mergeResearchSources, sourceDomains } from "./research-sources.ts";
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
