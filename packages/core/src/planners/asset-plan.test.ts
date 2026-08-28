import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { planAssetSources, type PlannableScene } from "./asset-plan.ts";

const scenes: PlannableScene[] = [
  { order: 0, role: "hook" },
  { order: 1, role: "content" },
  { order: 2, role: "content" },
  { order: 3, role: "cta" },
];

test("hook usa afiliado quando disponível; cota vai para contents", () => {
  const plan = planAssetSources({
    scenes,
    hasAffiliateImage: true,
    imageGenerationEnabled: true,
    imageQuotaRemaining: 2,
  });
  deepStrictEqual(plan.map((p) => p.source), ["affiliate", "generated", "generated", "pexels"]);
});

test("sem afiliado, hook consome a primeira unidade de cota", () => {
  const plan = planAssetSources({
    scenes,
    hasAffiliateImage: false,
    imageGenerationEnabled: true,
    imageQuotaRemaining: 1,
  });
  deepStrictEqual(plan.map((p) => p.source), ["generated", "pexels", "pexels", "pexels"]);
});

test("geração desabilitada (free tier não confirmado) → afiliado + pexels", () => {
  const plan = planAssetSources({
    scenes,
    hasAffiliateImage: false,
    imageGenerationEnabled: false,
    imageQuotaRemaining: 99,
  });
  deepStrictEqual(plan.map((p) => p.source), ["pexels", "pexels", "pexels", "pexels"]);
});

test("cta nunca gasta cota, mesmo sobrando", () => {
  const plan = planAssetSources({
    scenes,
    hasAffiliateImage: true,
    imageGenerationEnabled: true,
    imageQuotaRemaining: 10,
  });
  strictEqual(plan.find((p) => p.role === "cta")!.source, "pexels");
});

test("cota negativa é tratada como zero", () => {
  const plan = planAssetSources({
    scenes,
    hasAffiliateImage: false,
    imageGenerationEnabled: true,
    imageQuotaRemaining: -5,
  });
  deepStrictEqual(plan.map((p) => p.source), ["pexels", "pexels", "pexels", "pexels"]);
});

test("mantém a ordem original das cenas na saída", () => {
  const plan = planAssetSources({
    scenes: [...scenes].reverse(),
    hasAffiliateImage: true,
    imageGenerationEnabled: false,
    imageQuotaRemaining: 0,
  });
  deepStrictEqual(plan.map((p) => p.order), [0, 1, 2, 3]);
});
