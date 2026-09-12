import { test } from "node:test";
import { ok, throws, strictEqual } from "node:assert";
import { makeReviewSnapshot } from "../testing/review-fixture.ts";
import { buildReviewPacket } from "./review-packet.ts";

const id = "33333333-3333-4333-8333-333333333333";
test("ficha inclui conteúdo integral, fontes, licenças e decisão clara sem exceder limites Telegram", () => {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json.metadata.youtube.title = "🔋".repeat(50);
  snapshot.episode.script_json.scenes[0]!.narration_text = "🔋".repeat(500);
  snapshot.episode.script_json.narration.full_text = snapshot.episode.script_json.scenes.map(scene => scene.narration_text).join(" ");
  const packet = buildReviewPacket(snapshot, id);
  ok(packet.caption.length <= 1024);
  for (const text of ["ROTEIRO COMPLETO", "FONTES E EVIDÊNCIAS", "Fixture author", "Descrição TikTok", "não faz upload"]) {
    ok(packet.document.includes(text), text);
  }
  const buttons = packet.reply_markup.inline_keyboard.flat();
  strictEqual(buttons.length, 5);
  for (const button of buttons) if ("callback_data" in button) ok(new TextEncoder().encode(button.callback_data).length <= 64);
});

test("ficha não envia conteúdo sem evidências, com QA reprovado ou URL de ação ativa", () => {
  for (const mutate of [
    (s: ReturnType<typeof makeReviewSnapshot>) => { s.episode.research_data[0]!.claim = "Modificado"; },
    (s: ReturnType<typeof makeReviewSnapshot>) => { s.episode.script_json.metadata.youtube.title = "Cura tudo"; },
    (s: ReturnType<typeof makeReviewSnapshot>) => { s.episode.metadata.render_outputs.portrait = "javascript:alert(1)"; },
    (s: ReturnType<typeof makeReviewSnapshot>) => { s.episode.render_url = "https://example.com/other.mp4"; },
  ]) {
    const snapshot = makeReviewSnapshot(); mutate(snapshot);
    throws(() => buildReviewPacket(snapshot, id));
  }
});

test("texto do modelo permanece texto e não é interpretado como markup na ficha", () => {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.script_json.metadata.youtube.title = "<b>Teste</b> [texto](https://example.test)";
  const packet = buildReviewPacket(snapshot, id);
  ok(packet.caption.includes("<b>Teste</b>"));
  strictEqual("parse_mode" in packet, false);
});
