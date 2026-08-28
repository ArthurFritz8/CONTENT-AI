import { strictEqual } from "node:assert";
import { test } from "node:test";
import { researchDataSchema } from "./research.ts";

const validClaim = {
  claim: "O produto tem bateria de 12 horas",
  source_url: "https://example.com/review",
  confidence: 0.9,
  query_used: "produto X bateria review",
};

test("aceita research_data válido", () => {
  strictEqual(researchDataSchema.safeParse([validClaim]).success, true);
});

test("rejeita array vazio, confidence fora de 0-1 e URL inválida", () => {
  strictEqual(researchDataSchema.safeParse([]).success, false);
  strictEqual(
    researchDataSchema.safeParse([{ ...validClaim, confidence: 1.5 }]).success,
    false,
  );
  strictEqual(
    researchDataSchema.safeParse([{ ...validClaim, source_url: "nao-e-url" }]).success,
    false,
  );
});
