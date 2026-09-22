import { test } from "node:test";
import { ok, throws, strictEqual } from "node:assert";
import assert from "node:assert/strict";
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

test("revisão antiga não recebe aprovação técnica fictícia", () => {
  const packet = buildReviewPacket(makeReviewSnapshot(), id);
  ok(packet.document.includes("QA técnico não registrado"));
  ok(packet.document.includes("Google Search via Gemini"));
  ok(!packet.document.includes("decodificação verificada"));
});

test("ficha mostra medições e trechos Tavily, distinguindo confiança de verificação", () => {
  const snapshot = makeReviewSnapshot();
  const report = { version: "1.0.0", decode_verified: true, duration_seconds: 34, size_bytes: 2_097_152,
    width: 1920, height: 1080, warnings: ["Revisar ritmo."] };
  const evidence = { version: "2.0.0", provider: "tavily_search", model: "fixture", captured_at: "2026-09-14T12:00:00Z",
    query: "gadget", research: snapshot.episode.research_data,
    sources: snapshot.episode.research_data.map(item => ({ title: "Fonte recuperada", url: item.source_url,
      content: "Trecho da fonte para conferência do contexto pelo revisor.", score: 0.9 })) };
  const updated = { ...snapshot, episode: { ...snapshot.episode, research_evidence: evidence,
    metadata: { render_outputs: { ...snapshot.episode.metadata.render_outputs,
      quality: { landscape: report, portrait: { ...report, width: 1080, height: 1920 } } } } } };
  const packet = buildReviewPacket(updated, id);
  for (const value of ["34.00s", "1080×1920", "Revisar ritmo.", "Busca: Tavily", "Trecho da fonte", "confiança estimada pelo modelo"]) {
    ok(packet.document.includes(value), value);
  }
  ok(!packet.document.includes("Google Search via Gemini"));
});

test("ficha comercial exibe o link registrado para conferência humana", () => {
  const snapshot = makeReviewSnapshot();
  snapshot.episode.product_compliance = { commercial_content: true, affiliate_link: "https://shop.example/p/123?aff=fritz" } as any;
  snapshot.episode.script_json.disclosures = {
    contains_synthetic_media: true, commercial_content: true,
    commercial_disclosure_text: "Este vídeo contém link de afiliado.",
  };
  snapshot.episode.script_json.metadata.youtube.description += " Este vídeo contém link de afiliado.";
  snapshot.episode.script_json.metadata.tiktok.description += " Este vídeo contém link de afiliado.";
  snapshot.episode.script_json.scenes.at(-1)!.narration_text += " Este vídeo contém link de afiliado.";
  snapshot.episode.script_json.narration.full_text = snapshot.episode.script_json.scenes.map(scene => scene.narration_text).join(" ");
  const packet = buildReviewPacket(snapshot, id);
  assert.ok(packet.document.includes("Link de afiliado YouTube: https://shop.example/p/123?aff=fritz"));
});
