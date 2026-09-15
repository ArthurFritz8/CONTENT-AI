import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { pickPresenterPhoto, type SpokesmodelConfig } from "./spokesmodel-plan.ts";

const photo = (id: number) => ({
  pexels_id: id,
  landscape_url: `https://images.pexels.com/photos/${id}/landscape.jpg`,
  portrait_url: `https://images.pexels.com/photos/${id}/portrait.jpg`,
  author: "SHVETS production",
  pexels_url: `https://www.pexels.com/photo/${id}/`,
});

test("desabilitado retorna null mesmo com fotos configuradas", () => {
  const cfg: SpokesmodelConfig = { enabled: false, fixed_photos: [photo(1), photo(2)] };
  strictEqual(pickPresenterPhoto(cfg, 0), null);
});

test("habilitado sem fotos retorna null", () => {
  const cfg: SpokesmodelConfig = { enabled: true, fixed_photos: [] };
  strictEqual(pickPresenterPhoto(cfg, 0), null);
});

test("habilitado com fotos distribui por ordem da cena (round-robin)", () => {
  const cfg: SpokesmodelConfig = { enabled: true, fixed_photos: [photo(1), photo(2), photo(3)] };
  deepStrictEqual(pickPresenterPhoto(cfg, 0), photo(1));
  deepStrictEqual(pickPresenterPhoto(cfg, 1), photo(2));
  deepStrictEqual(pickPresenterPhoto(cfg, 3), photo(1));
});
