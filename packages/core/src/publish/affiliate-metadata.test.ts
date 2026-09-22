import { test } from "node:test";
import assert from "node:assert/strict";
import {
  affiliateLinkForPlatform,
  affiliateLinksFromCompliance,
  applyAffiliateMetadata,
  DEFAULT_AFFILIATE_DISCLOSURE,
} from "./affiliate-metadata.ts";

const base = () => ({
  metadata: { youtube: { description: "Descrição YouTube" }, tiktok: { description: "Descrição TikTok" } },
  disclosures: { commercial_content: true, commercial_disclosure_text: null },
});

test("cada descrição recebe somente o link afiliado da própria plataforma", () => {
  const links = {
    youtube: "https://amazon.example/p/123?tag=fritz",
    tiktok: "https://shop.tiktok.example/p/456?affiliate=fritz",
  };
  const first = applyAffiliateMetadata(base(), links, true) as any;
  assert.match(first.metadata.youtube.description, /Link do produto: https:\/\/amazon\.example\/p\/123\?tag=fritz/);
  assert.doesNotMatch(first.metadata.youtube.description, /shop\.tiktok/);
  assert.match(first.metadata.tiktok.description, /Link do produto: https:\/\/shop\.tiktok\.example\/p\/456\?affiliate=fritz/);
  assert.doesNotMatch(first.metadata.tiktok.description, /amazon\.example/);
  assert.equal(first.disclosures.commercial_disclosure_text, DEFAULT_AFFILIATE_DISCLOSURE);
  const second = applyAffiliateMetadata(first, links, true) as any;
  assert.equal(second.metadata.youtube.description, first.metadata.youtube.description);
});

test("link de uma plataforma não vaza para a outra", () => {
  const result = applyAffiliateMetadata(
    base(),
    { youtube: "https://amazon.example/p/123?tag=fritz" },
    true,
  ) as any;
  assert.match(result.metadata.youtube.description, /amazon\.example/);
  assert.doesNotMatch(result.metadata.tiktok.description, /amazon\.example/);
  assert.match(result.metadata.tiktok.description, /Este vídeo contém link de afiliado/);
});

test("conteúdo não comercial não recebe CTA de afiliado; URL insegura falha fechado", () => {
  const plain = applyAffiliateMetadata(base(), { youtube: "https://shop.example/p/123" }, false) as any;
  assert.equal(plain.metadata.youtube.description, "Descrição YouTube");
  assert.throws(() => applyAffiliateMetadata(base(), { youtube: "http://shop.example/p/123" }, true), /HTTPS/);
  assert.throws(() => applyAffiliateMetadata(base(), { tiktok: "https://user:pass@shop.example/p/123" }, true), /HTTPS/);
});

test("compatibilidade antiga fica limitada ao YouTube e o mapa rejeita plataformas desconhecidas", () => {
  const legacy = { affiliate_link: "https://shop.example/p/123?tag=legacy" };
  assert.deepEqual(affiliateLinksFromCompliance(legacy), {
    youtube: "https://shop.example/p/123?tag=legacy",
  });
  assert.equal(affiliateLinkForPlatform(legacy, "youtube"), legacy.affiliate_link);
  assert.equal(affiliateLinkForPlatform(legacy, "tiktok"), null);
  assert.throws(
    () => affiliateLinksFromCompliance({
      affiliate_links: { instagram: "https://shop.example/p/123" },
    }),
    /Unrecognized key/,
  );
});
