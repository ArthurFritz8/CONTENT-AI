import { test } from "node:test";
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeReviewSnapshot } from "../../../packages/core/src/testing/review-fixture.ts";
import { publishYoutubePrivate, type PublishRow, type PublishStore } from "./publish-youtube.ts";
import { sessionUrl, type HttpFetch } from "./youtube-client.ts";

const media = new TextEncoder().encode("fixture-video-bytes");
const hash = createHash("sha256").update(media).digest("hex");
const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture";
const channelId = `UC${"a".repeat(22)}`;
const videoId = "private1234";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fixture() {
  const snapshot = makeReviewSnapshot();
  const origin = "https://project.supabase.co";
  snapshot.episode.metadata.render_outputs.landscape = `${origin}/storage/v1/object/public/assets/episodes/${snapshot.episode.id}/render/final/${hash}/episode_landscape.mp4`;
  const row: PublishRow = { id: snapshot.episode.id, status: "processing", external_id: null, review_snapshot: snapshot,
    upload_config: { max_video_bytes: 52428800, made_for_kids: false, category_ids: { Education: "27" } },
    session_url: null, media_sha256: null, media_bytes: null, channel_id: null };
  const calls: string[] = [];
  const store: PublishStore = {
    claim: async () => row,
    guard: async () => { calls.push("guard"); },
    authorizeSession: async () => { calls.push("authorize"); },
    checkpoint: async (_id, _owner, url, digest, bytes, channel) => {
      calls.push("checkpoint"); row.session_url = url; row.media_sha256 = digest; row.media_bytes = bytes; row.channel_id = channel;
    },
    finish: async (_id, _owner, id) => { calls.push("finish"); row.status = "published"; row.external_id = id; },
  };
  let put: (init: RequestInit) => Response | Promise<Response> = init => new Headers(init.headers).get("Content-Range")?.startsWith("bytes */")
    ? new Response(null, { status: 308 }) : json({ id: videoId, status: { privacyStatus: "private" } }, 201);
  const http: HttpFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(`${init.method ?? "GET"} ${url.split("?")[0]}`);
    equal(init.redirect, init.method === "PUT" && url.startsWith(session) ? "manual" : "error");
    if (url.startsWith(origin)) return new Response(media);
    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "fixture-access" });
    if (url.includes("/channels?")) return json({ items: [{ id: channelId }] });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      equal(body.status.privacyStatus, "private"); equal(body.status.containsSyntheticMedia, true);
      equal(body.snippet.title, snapshot.episode.script_json.metadata.youtube.title);
      ok(url.includes("notifySubscribers=false"));
      return new Response(null, { headers: { Location: session } });
    }
    ok(calls.includes("checkpoint") || row.session_url, "durable session before bytes");
    return await put(init);
  };
  const args = { episodeId: snapshot.episode.id, supabaseUrl: origin, store, http,
    auth: { clientId: "fixture-client", clientSecret: "fixture-secret", refreshToken: "fixture-refresh", channelId }, sleep: async (_ms: number) => {} };
  return { args, row, calls, setPut: (handler: typeof put) => { put = handler; } };
}
test("upload private once; repeated run makes zero HTTP requests", async () => {
  const f = fixture();
  deepEqual(await publishYoutubePrivate(f.args), { videoId, alreadyUploaded: false });
  const count = f.calls.length;
  deepEqual(await publishYoutubePrivate(f.args), { videoId, alreadyUploaded: true });
  equal(f.calls.length, count);
  equal(f.calls.filter(c => c === "finish").length, 1);
});
test("lost final response is reconciled by status query without another POST or chunk", async () => {
  const f = fixture(); let chunks = 0; let probes = 0;
  f.setPut(init => {
    if (new Headers(init.headers).get("Content-Range")?.startsWith("bytes */")) {
      probes++;
      return chunks ? json({ id: videoId, status: { privacyStatus: "private" } }) : new Response(null, { status: 308 });
    }
    chunks++; throw new Error("sensitive provider URL");
  });
  equal((await publishYoutubePrivate(f.args)).videoId, videoId);
  equal(chunks, 1); equal(probes, 2);
  equal(f.calls.filter(c => c.startsWith("POST https://www.googleapis.com/upload")).length, 1);
});
test("checkpoint failure sends no media; hash mismatch never requests OAuth", async () => {
  const f = fixture(); f.args.store.checkpoint = async () => { throw new Error("database unavailable"); };
  await rejects(publishYoutubePrivate(f.args), /database unavailable/);
  equal(f.calls.filter(c => c.startsWith("PUT")).length, 0);
  const g = fixture(); const original = g.args.http;
  g.args.http = async (url, init) => String(url).includes("supabase.co") ? new Response("tampered") : original(url, init);
  await rejects(publishYoutubePrivate(g.args), /divergem/);
  equal(g.calls.length, 0);
});
test("resumed session uses server offset and never creates a new session", async () => {
  const f = fixture(); Object.assign(f.row, { session_url: session, media_sha256: hash, media_bytes: media.length, channel_id: channelId });
  f.setPut(init => {
    const range = new Headers(init.headers).get("Content-Range");
    if (range?.startsWith("bytes */")) return new Response(null, { status: 308, headers: { Range: "bytes=0-4" } });
    equal(range, `bytes 5-${media.length - 1}/${media.length}`);
    deepEqual(init.body, media.slice(5));
    return json({ id: videoId, status: { privacyStatus: "private" } });
  });
  await publishYoutubePrivate(f.args);
  equal(f.calls.filter(c => c.startsWith("POST https://www.googleapis.com/upload")).length, 0);
});
test("expired session stops without recreation; wrong channel stops before initiation", async () => {
  const f = fixture(); Object.assign(f.row, { session_url: session, media_sha256: hash, media_bytes: media.length, channel_id: channelId });
  f.setPut(() => new Response(null, { status: 404 }));
  await rejects(publishYoutubePrivate(f.args), /expirada/);
  equal(f.calls.filter(c => c.startsWith("POST https://www.googleapis.com/upload")).length, 0);
  const g = fixture(); g.args.auth.channelId = `UC${"b".repeat(22)}`;
  await rejects(publishYoutubePrivate(g.args), /outro canal/);
  equal(g.calls.filter(c => c.startsWith("POST https://www.googleapis.com/upload")).length, 0);
});
test("revoked approval stops before next chunk; untrusted session URL rejected", async () => {
  const f = fixture(); let guards = 0;
  f.args.store.guard = async () => { if (++guards === 3) throw new Error("approval revoked"); };
  await rejects(publishYoutubePrivate(f.args), /approval revoked/);
  equal(f.calls.filter(c => c.startsWith("PUT")).length, 1); // status probe only
  for (const url of ["https://evil.test/upload", "https://www.googleapis.com.evil.test/upload", "http://www.googleapis.com/upload/youtube/v3/videos?upload_id=x"]) {
    await rejects(async () => sessionUrl(url));
  }
});
test("daily reservation and size limit reject before upload initiation", async () => {
  const f = fixture(); f.args.store.authorizeSession = async () => { throw new Error("daily limit reached"); };
  await rejects(publishYoutubePrivate(f.args), /daily limit/);
  equal(f.calls.filter(c => c.startsWith("POST https://www.googleapis.com/upload")).length, 0);
  const g = fixture(); (g.row.upload_config as { max_video_bytes: number }).max_video_bytes = 1;
  await rejects(publishYoutubePrivate(g.args), /limite configurado/);
  equal(g.calls.filter(c => c.includes("oauth2.googleapis.com")).length, 0);
});
test("Retry-After is honored and public confirmations never complete the ledger", async () => {
  const f = fixture(); const delays: number[] = [];
  f.args.sleep = async (ms: number) => { delays.push(ms); };
  f.setPut(init => new Headers(init.headers).get("Content-Range")?.startsWith("bytes */")
    ? new Response(null, { status: 308, headers: { "Retry-After": "5" } })
    : json({ id: videoId, status: { privacyStatus: "private" } }));
  await publishYoutubePrivate(f.args);
  deepEqual(delays, [5000]);
  const g = fixture(); g.setPut(() => json({ id: videoId, status: { privacyStatus: "public" } }));
  await rejects(publishYoutubePrivate(g.args), /privacidade privada/);
  equal(g.row.external_id, null);
});
