import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAffiliateMetadata, DEFAULT_AFFILIATE_DISCLOSURE } from "./affiliate-metadata.ts";

const base = () => ({
  metadata: { youtube: { description: "Descrição YouTube" }, tiktok: { description: "Descrição TikTok" } },
  disclosures: { commercial_content: true, commercial_disclosure_text: null },
});

test("link e disclosure entram nas duas descrições e não duplicam em retry", () => {
  const first = applyAffiliateMetadata(base(), "https://shop.example/p/123?aff=fritz", true) as any;
  assert.match(first.metadata.youtube.description, /Link do produto: https:\/\/shop\.example\/p\/123\?aff=fritz/);
  assert.match(first.metadata.tiktok.description, /Este vídeo contém link de afiliado/);
  assert.equal(first.disclosures.commercial_disclosure_text, DEFAULT_AFFILIATE_DISCLOSURE);
  const second = applyAffiliateMetadata(first, "https://shop.example/p/123?aff=fritz", true) as any;
  assert.equal(second.metadata.youtube.description, first.metadata.youtube.description);
});

test("conteúdo não comercial não recebe CTA de afiliado; URL insegura falha fechado", () => {
  const plain = applyAffiliateMetadata(base(), "https://shop.example/p/123", false) as any;
  assert.equal(plain.metadata.youtube.description, "Descrição YouTube");
  assert.throws(() => applyAffiliateMetadata(base(), "http://shop.example/p/123", true), /HTTPS/);
  assert.throws(() => applyAffiliateMetadata(base(), "https://user:pass@shop.example/p/123", true), /HTTPS/);
});
