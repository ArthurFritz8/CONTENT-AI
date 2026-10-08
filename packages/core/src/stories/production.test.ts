import { test } from "node:test";
import { strictEqual, deepStrictEqual, throws, notStrictEqual } from "node:assert";
import { productionProfileHash, quoteSeriesProduction } from "./production.ts";
import { routeVideoShot, type VideoProvider } from "./video-routing.ts";
import { storyRequestSchema, proposalBibleSchema } from "./schema.ts";
import { biblePrompt } from "./prompts.ts";
import { storyFixture } from "../testing/story-fixture.ts";

const now = 1000000, series = "11111111-1111-4111-8111-111111111111", profile = "a".repeat(64), execution = "b".repeat(64);
const shot = { version: "1.0.0", id: "talk", kind: "dialogue", reference_path: "own.png", reference_sha256: profile,
  prompt: "A personagem pergunta pelo segredo, olhando para o outro personagem.", seconds: 4, seed: 42,
  quality: "approved_master", min_short_edge: 704, min_output_fps: 60, audio_sha256: profile,
  continuity: { series_id: series, profile_sha256: profile } };
const provider = (id: string, group = id): VideoProvider => ({ id, quota_group: group, available: true, adapter_ready: true,
  checked_at: now, cooldown_until: 0, free_remaining: 100, reserved: 0, required: 10, cash_cost: 0,
  free_tier: "recurring", billing: "credits", capabilities: ["dialogue"], quality: ["approved_master"],
  short_edge: 704, output_fps: 60, max_seconds: 5, execution_sha256: execution,
  continuity_approvals: [{ series_id: series, profile_sha256: profile, execution_sha256: execution, capabilities: ["dialogue"] }] });
const wallet = (group: string, amount = 20) => ({ quota_group: group, unit: "credits", remaining_units: amount, held_units: 0, checked_at: now, valid_until: now + 5000 });
const chapter = (id: string, units = 10) => ({ id, shots: [{ shot, quotes: ["a", "b"].map(provider_id => ({ provider_id, execution_sha256: execution, units, cash_cost: 0 })) }] });

test("automatic conception accepts no idea and manual conception still requires one", () => {
  const input = storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3, creation_mode: "automatic" });
  strictEqual(input.premise, ""); strictEqual(biblePrompt(input).includes("CRIAÇÃO AUTOMÁTICA"), true);
  throws(() => storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3 }));
  strictEqual(storyRequestSchema.parse({ kind: "fruits", genre: "mystery", chapters: 3, premise: "Duas frutas encontram uma carta misteriosa na feira." }).creation_mode, "manual");
  throws(() => storyRequestSchema.parse({ ...input, premise: "x".repeat(1001) }));
});
test("new proposals require the whole narrative; old saved bibles remain readable", () => {
  const bible = storyFixture().context.bible;
  throws(() => proposalBibleSchema.parse(bible));
  const complete = { ...bible, world: "Uma pequena feira brasileira cheia de segredos.",
    central_conflict: "Uma carta perdida ameaça a amizade das duas frutas da feira.", ending: "As duas frutas revelam o segredo e recuperam sua amizade.",
    cast: bible.cast.map(c => ({ ...c, role: "protagonist", goal: "Descobrir o segredo da carta.", appearance_description: "Fruta adulta com vestido ou camisa, rosto expressivo e cores estáveis." })),
    relationships: [{ from: bible.cast[0]!.id, to: bible.cast[1]!.id, description: "Amigos que discordam sobre a carta." }] };
  strictEqual(proposalBibleSchema.parse(complete).cast.length, bible.cast.length);
  throws(() => proposalBibleSchema.parse({ ...complete, relationships: [{ ...complete.relationships[0], to: "unknown" }] }));
});
test("provider changes require series, identity, execution and task compatibility", () => {
  strictEqual(routeVideoShot(shot, [provider("a")], now).selected, "a");
  for (const p of [{ ...provider("a"), continuity_approvals: [] }, { ...provider("a"), execution_sha256: "c".repeat(64) },
    { ...provider("a"), continuity_approvals: [{ ...provider("a").continuity_approvals![0]!, series_id: "22222222-2222-4222-8222-222222222222" }] },
    { ...provider("a"), continuity_approvals: [{ ...provider("a").continuity_approvals![0]!, capabilities: ["reaction"] as ["reaction"] }] }]) {
    deepStrictEqual(routeVideoShot(shot, [p], now).reasons, [{ provider: "a", reason: "series_incompatible" }]);
  }
  strictEqual(routeVideoShot({ ...shot, continuity: undefined }, [provider("a")], now).selected, null);
});
test("capacity adds independent compatible wallets and counts a shared wallet once", () => {
  const plan = [chapter("1"), chapter("2"), chapter("3")];
  strictEqual(quoteSeriesProduction(plan, [provider("a"), provider("b")], [wallet("a"), wallet("b")], now).estimated_complete_chapters, 3);
  strictEqual(quoteSeriesProduction(plan, [provider("a", "shared"), provider("b", "shared")], [wallet("shared")], now).estimated_complete_chapters, 2);
  throws(() => quoteSeriesProduction(plan, [provider("a")], [wallet("a"), wallet("a")], now));
});
test("incompatible and stale credit cannot inflate continuation capacity", () => {
  const plan = [chapter("1"), chapter("2")];
  strictEqual(quoteSeriesProduction(plan, [provider("a"), { ...provider("b"), continuity_approvals: [] }], [wallet("a", 10), wallet("b", 100)], now).estimated_complete_chapters, 1);
  for (const change of [{ checked_at: now - 300001 }, { valid_until: now }, { held_units: 20 }, { remaining_units: NaN }, { checked_at: now + 1 }])
    strictEqual(quoteSeriesProduction(plan, [provider("a")], [{ ...wallet("a"), ...change }], now).estimated_complete_chapters, 0);
});
test("partial chapters do not consume estimate balance; revisions and paid quotes fail closed", () => {
  const twoShots = { id: "1", shots: [...chapter("1").shots, { ...chapter("1").shots[0]!, shot: { ...shot, id: "second" } }] };
  const result = quoteSeriesProduction([twoShots], [provider("a")], [wallet("a", 15)], now);
  strictEqual(result.estimated_complete_chapters, 0); deepStrictEqual(result.remaining_by_wallet, { a: 15 });
  for (const change of [{ execution_sha256: "c".repeat(64) }, { units: 0 }, { units: 1.5 }, { cash_cost: 0.01 }]) {
    const c = chapter("1"); c.shots[0]!.quotes = [{ ...c.shots[0]!.quotes[0]!, ...change }];
    strictEqual(quoteSeriesProduction([c], [provider("a")], [wallet("a")], now).estimated_complete_chapters, 0);
  }
});
test("canonical profile hashes bind references and voices without depending on a GPU host", async () => {
  const p = { version: "1.0.0", orientation: "portrait", short_edge: 704, output_fps: 60,
    style: "Animação 3D estilizada com materiais detalhados e personagens adultos.",
    references: ["a", "b"].map(character_id => ({ character_id, path: `${character_id}.png`, sha256: profile })),
    voices: ["a", "b"].map(character_id => ({ character_id, engine: "tts", voice_id: character_id, version: "1", sample_sha256: profile })) };
  strictEqual(await productionProfileHash(p), await productionProfileHash({ ...p, style: p.style }));
  notStrictEqual(await productionProfileHash(p), await productionProfileHash({ ...p, voices: p.voices.map(v => ({ ...v, version: "2" })) }));
});
