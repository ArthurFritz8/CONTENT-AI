import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedUser,
  assertOrigin,
  mediaUrl,
  mutation,
  pagination,
  redact,
} from "../lib/security.mjs";
const id = "12345678-1234-4234-9234-123456789abc";
test("administrator allowlist is exact and fails closed", () => {
  assert.equal(allowedUser(id, ""), false);
  assert.equal(allowedUser(id + "x", id), false);
  assert.equal(allowedUser(id, ` ${id} `), true);
});
test("mutations require configured exact origin even with same-site header", () => {
  const req = (origin) =>
    new Request("https://panel.test/api", {
      headers: origin ? { origin } : {},
    });
  assert.throws(() => assertOrigin(req(null), "https://panel.test"));
  assert.throws(() =>
    assertOrigin(req("https://panel.test.evil.test"), "https://panel.test"),
  );
  assert.doesNotThrow(() =>
    assertOrigin(req("https://panel.test"), "https://panel.test"),
  );
});
test("media URLs cannot leak credentials or send the player to a different host", () => {
  const root = "https://demo.supabase.co",
    url = root + "/storage/v1/object/public/assets/video.mp4";
  assert.equal(mediaUrl(url, root), url);
  for (const bad of [
    url + "?token=abc",
    url.replace("demo", "evil"),
    "https://user:pass@demo.supabase.co/storage/v1/object/public/a",
    root + "/rest/v1/episodes",
    "javascript:alert(1)",
  ])
    assert.equal(mediaUrl(bad, root), null);
});
test("server strips unauthorized fields and validates queue input", () => {
  const input = {
    requestId: id,
    action: "add",
    payload: {
      briefing: "Um produto para organizar a mesa de trabalho.",
      priority: 50,
      affiliate_links: {
        youtube: "https://amazon.example/product?tag=creator",
        tiktok: "https://shop.tiktok.example/product?affiliate=creator",
      },
      status: "published",
      approval_user: "attacker",
    },
  };
  const r = mutation(input);
  assert.equal(r.payload.status, undefined);
  assert.equal(
    r.payload.affiliate_links.youtube,
    "https://amazon.example/product?tag=creator",
  );
  assert.equal(
    r.payload.affiliate_links.tiktok,
    "https://shop.tiktok.example/product?affiliate=creator",
  );
  assert.throws(() =>
    mutation({ ...input, payload: { ...input.payload, priority: -1 } }),
  );
  assert.throws(() =>
    mutation({
      ...input,
      payload: {
        ...input.payload,
        affiliate_links: {
          youtube: "https://secret:password@example.com/",
        },
      },
    }),
  );
  assert.throws(() =>
    mutation({
      ...input,
      payload: {
        ...input.payload,
        affiliate_links: { instagram: "https://example.com/product" },
      },
    }),
  );
  assert.throws(() => mutation({ ...input, action: "publish" }));
});
test("settings cannot turn off human review or enable autopublish", () => {
  const r = mutation({
    requestId: id,
    action: "pipeline",
    payload: {
      enabled: false,
      max_episodes_per_day: 1,
      revision: new Date().toISOString(),
      auto_publish: true,
      require_human_approval: false,
    },
  });
  assert.equal(r.payload.auto_publish, undefined);
  assert.equal(r.payload.require_human_approval, undefined);
  assert.throws(() =>
    mutation({
      requestId: id,
      action: "pipeline",
      payload: { enabled: "true", max_episodes_per_day: 1 },
    }),
  );
});
test("PostgREST filter fragments and unbounded pagination rejected", () => {
  for (const q of [
    "search=hello,world",
    "search=*",
    "page=-1",
    "page=1.5",
    "status=eq.failed",
  ])
    assert.throws(() => pagination(new URLSearchParams(q)));
  assert.deepEqual(pagination(new URLSearchParams("page=2&search=mochila")), {
    page: 2,
    search: "mochila",
    status: "",
    limit: 20,
    offset: 20,
  });
});
test("errors redact known secrets and signed URL parameters", () => {
  const text = redact(
    "Bearer private-value https://host.test/video?signature=private api-key-content",
    ["api-key-content"],
  );
  assert.ok(!text.includes("private-value"));
  assert.ok(!text.includes("signature"));
  assert.ok(!text.includes("api-key-content"));
});
