import { assertEquals } from "jsr:@std/assert@1";
import { selectPexelsPhotos } from "./pexels-selection.ts";
import type { PexelsPhoto } from "./pexels.ts";

function photo(id: number, alt: string): PexelsPhoto {
  return { id, alt, author: "Author", pexels_url: `https://www.pexels.com/photo/${id}/`,
    landscape_url: `https://images.pexels.com/${id}-landscape.jpg`,
    portrait_url: `https://images.pexels.com/${id}-portrait.jpg` };
}

Deno.test("seleção evita repetição e marcas não mencionadas, priorizando contexto da consulta", () => {
  const candidates = [
    photo(1, "DJI action camera on a desk"),
    photo(2, "Man holding a compact smart device"),
    photo(3, "Compact device on a desk"),
    photo(4, "Compact device next to a notebook"),
  ];
  const result = selectPexelsPhotos(candidates, "compact smart device", "Muse Charm é um dispositivo", new Set([candidates[2]!.pexels_url]));
  assertEquals(result.map((item) => item.id), [2, 4]);
  assertEquals(selectPexelsPhotos([photo(1, "DJI action camera")], "DJI camera", "Câmera DJI", new Set()).length, 1);
  assertEquals(selectPexelsPhotos([photo(5, "Compact USB-C hub on a desk")],
    "compact desk device", "Assistente de IA portátil Muse Charm", new Set()).length, 0);
});
