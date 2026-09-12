import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { isRenderReady, scriptJsonSchema } from "./script-json.ts";

import { makeValidScript } from "../testing/script-fixture.ts";

test("aceita script válido no estado 'script' (assets null)", () => {
  const result = scriptJsonSchema.safeParse(makeValidScript());
  strictEqual(result.success, true);
});

test("highlight_words: default vazio e máximo 3", () => {
  const script = makeValidScript();
  delete (script.scenes[0] as { highlight_words?: string[] }).highlight_words;
  const parsed = scriptJsonSchema.parse(script);
  deepStrictEqual(parsed.scenes[0]!.highlight_words, []);

  const invalid = makeValidScript();
  invalid.scenes[0]!.highlight_words = ["a", "b", "c", "d"];
  strictEqual(scriptJsonSchema.safeParse(invalid).success, false);
});

test("rejeita menos de 3 cenas", () => {
  const script = makeValidScript();
  script.scenes = script.scenes.slice(0, 2);
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("array de cenas vazio retorna erro de validação, nunca TypeError", () => {
  const script = makeValidScript();
  script.scenes = [];
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("rejeita scene ids duplicados e conta aspas implícitas nas tags com espaços", () => {
  const duplicate = makeValidScript();
  duplicate.scenes[1]!.id = duplicate.scenes[0]!.id;
  strictEqual(scriptJsonSchema.safeParse(duplicate).success, false);
  const tags = makeValidScript();
  tags.metadata.youtube.tags = ["a ".repeat(249)];
  strictEqual(scriptJsonSchema.safeParse(tags).success, true);
  tags.metadata.youtube.tags = ["a ".repeat(250)];
  strictEqual(scriptJsonSchema.safeParse(tags).success, false);
});

test("rejeita duration_seconds fora de 5-45", () => {
  const script = makeValidScript();
  script.scenes[0]!.duration_seconds = 60;
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("rejeita order não-contíguo", () => {
  const script = makeValidScript();
  script.scenes[2]!.order = 5;
  const result = scriptJsonSchema.safeParse(script);
  strictEqual(result.success, false);
  ok(!result.success && result.error.issues.some((i) => i.message.includes("contíguo")));
});

test("rejeita commercial_content=true sem disclosure_text", () => {
  const script = makeValidScript();
  script.disclosures.commercial_content = true;
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("rejeita contains_synthetic_media=false", () => {
  const script = makeValidScript();
  // deno-lint-ignore no-explicit-any
  (script.disclosures as any).contains_synthetic_media = false;
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("rejeita script sem fontes", () => {
  const script = makeValidScript();
  script.sources = [];
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("regra 9: rejeita soma de targets fora de 60-600s", () => {
  const script = makeValidScript();
  for (const scene of script.scenes) scene.duration_seconds = 15; // soma 45s < 60
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("roles: rejeita primeira cena que não é hook e última que não é cta", () => {
  const a = makeValidScript();
  a.scenes[0]!.role = "content";
  strictEqual(scriptJsonSchema.safeParse(a).success, false);
  const b = makeValidScript();
  b.scenes[2]!.role = "content";
  strictEqual(scriptJsonSchema.safeParse(b).success, false);
});

test("gap_seconds: aplica default 0.5 quando ausente e rejeita > 5", () => {
  const script = makeValidScript();
  // deno-lint-ignore no-explicit-any
  delete (script as any).gap_seconds;
  const parsed = scriptJsonSchema.parse(script);
  strictEqual(parsed.gap_seconds, 0.5);
  script.gap_seconds = 6;
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
});

test("isRenderReady: false com assets null, true com todos resolvidos", () => {
  const script = makeValidScript();
  strictEqual(isRenderReady(script), false);
  const asset = { url: "https://example.com/img.jpg", license: "pexels", source: "pexels" } as const;
  for (const scene of script.scenes) {
    scene.asset_landscape = { ...asset };
    scene.asset_portrait = { ...asset };
  }
  strictEqual(isRenderReady(script), true);
});

test("schema parse não muta o input", () => {
  const script = makeValidScript();
  const clone = structuredClone(script);
  scriptJsonSchema.parse(script);
  deepStrictEqual(script, clone);
  notStrictEqual(script, clone);
});
