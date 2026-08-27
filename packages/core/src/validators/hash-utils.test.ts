import { notStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { makeValidScript } from "../schemas/script-json.test.ts";
import { canonicalStringify, computeScriptHash, sha256Hex } from "./hash-utils.ts";

test("canonicalStringify: ordem das chaves não altera a saída", () => {
  strictEqual(
    canonicalStringify({ b: 1, a: { d: 2, c: [3, null] } }),
    canonicalStringify({ a: { c: [3, null], d: 2 }, b: 1 }),
  );
});

test("canonicalStringify: ignora undefined mas preserva null", () => {
  strictEqual(
    canonicalStringify({ a: undefined, b: null }),
    canonicalStringify({ b: null }),
  );
});

test("sha256Hex: vetor conhecido", async () => {
  strictEqual(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("computeScriptHash: estável para o mesmo conteúdo editorial", async () => {
  strictEqual(
    await computeScriptHash(makeValidScript()),
    await computeScriptHash(makeValidScript()),
  );
});

test("computeScriptHash: ignora episode_id, prompt_version, music e assets", async () => {
  const a = makeValidScript();
  const b = makeValidScript();
  b.episode_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  b.prompt_version = "9.9.9";
  b.music = { url: "https://example.com/song.mp3", license: "youtube_audio_library", volume: 0.2 };
  b.scenes[0]!.asset_landscape = { url: "https://example.com/x.jpg", license: "pexels", source: "pexels" };
  strictEqual(await computeScriptHash(a), await computeScriptHash(b));
});

test("computeScriptHash: muda quando a narração muda", async () => {
  const a = makeValidScript();
  const b = makeValidScript();
  b.narration.full_text = "Outro texto completamente diferente.";
  notStrictEqual(await computeScriptHash(a), await computeScriptHash(b));
});
