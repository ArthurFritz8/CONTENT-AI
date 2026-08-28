import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { isRenderReady, scriptJsonSchema, type ScriptJson } from "./script-json.ts";

export function makeValidScript(): ScriptJson {
  const scene = (order: number, role: "hook" | "content" | "cta") => ({
    id: `scene-${order}`,
    order,
    role,
    duration_seconds: 20,
    narration_text: `Narração da cena ${order}`,
    transition: "fade" as const,
    ken_burns: "in" as const,
    visual: { description: `Imagem da cena ${order}`, search_query: `query ${order}` },
    asset_landscape: null,
    asset_portrait: null,
    subtitle_position: "bottom_center" as const,
  });
  return {
    episode_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    prompt_version: "1.0.0",
    metadata: {
      youtube: {
        title: "Título de teste",
        description: "Descrição de teste",
        tags: ["teste", "video"],
        category: "Education",
      },
      tiktok: {
        title: "Título TikTok",
        description: "Descrição TikTok",
        hashtags: ["#teste"],
      },
    },
    narration: {
      full_text: "Narração completa do episódio.",
      language: "pt-BR",
      estimated_duration_seconds: 60,
    },
    gap_seconds: 0.5,
    music: null,
    scenes: [scene(0, "hook"), scene(1, "content"), scene(2, "cta")],
    sources: [{ claim: "Afirmação X", source_url: "https://example.com/fonte" }],
    disclosures: {
      contains_synthetic_media: true,
      commercial_content: false,
      commercial_disclosure_text: null,
    },
  };
}

test("aceita script válido no estado 'script' (assets null)", () => {
  const result = scriptJsonSchema.safeParse(makeValidScript());
  strictEqual(result.success, true);
});

test("rejeita menos de 3 cenas", () => {
  const script = makeValidScript();
  script.scenes = script.scenes.slice(0, 2);
  strictEqual(scriptJsonSchema.safeParse(script).success, false);
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
