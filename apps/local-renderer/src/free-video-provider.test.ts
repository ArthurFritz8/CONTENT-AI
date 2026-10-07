import { test } from "node:test";
import { strictEqual, deepStrictEqual, throws, rejects, ok } from "node:assert";
import { HF_VIDEO, HF_SPEECH, assertOutputUrl, inspectSpaceMetadata, readVideoEvent, FreeVideoProvider } from "./free-video-provider.ts";

test("changed model revision and non-free hardware disable the provider", () => {
  const base = { sha: HF_VIDEO.revision, host: HF_VIDEO.host, runtime: { stage: "RUNNING", hardware: { current: "zero-a10g" } } };
  strictEqual(inspectSpaceMetadata(base).available, true);
  strictEqual(inspectSpaceMetadata({ ...base, sha: "changed" }).available, false);
  strictEqual(inspectSpaceMetadata({ ...base, runtime: { stage: "RUNNING", hardware: { current: "h200" } } }).available, false);
});
test("download cannot forward credentials to arbitrary URLs, redirects or query tokens", () => {
  for (const url of ["https://evil.test/a.mp4", "http://127.0.0.1/a.mp4", `${HF_VIDEO.host}/api/secret`, `${HF_VIDEO.host}/gradio_api/file=a?token=x`])
    throws(() => assertOutputUrl(url));
  ok(assertOutputUrl(`${HF_VIDEO.host}/gradio_api/file=/tmp/gradio/a.mp4`));
});
function stream(text: string, step = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += step) controller.enqueue(bytes.slice(i, i + step));
    controller.close();
  } });
}
test("SSE parser handles fragmented UTF8/CRLF and heartbeat without dropping the completed result", async () => {
  const url = `${HF_VIDEO.host}/gradio_api/file=/tmp/gradio/result.mp4`;
  strictEqual(await readVideoEvent(stream(`event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: [{"url":"${url}","orig_name":"ação.mp4"},42]\r\n\r\n`)), url);
});
test("quota, incomplete stream and bad outputs do not masquerade as generated videos", async () => {
  await rejects(readVideoEvent(stream('event: error\ndata: "GPU quota exceeded"\n\n')), /quota_rejected/);
  await rejects(readVideoEvent(stream('event: heartbeat\ndata: null\n\n')), /unknown/);
  await rejects(readVideoEvent(stream('event: complete\ndata: [{"url":"https://evil.test/file"},42]\n\n')), /contract_changed/);
});
test("stalled stream and stalled cancellation cannot hang beyond the client deadline", async () => {
  const stalled = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) });
  const started = Date.now();
  await rejects(readVideoEvent(stalled, HF_VIDEO, 25), /unknown/);
  ok(Date.now() - started < 1000);
});
test("authorization header is bound to allowlisted upload host and no redirect is followed", async () => {
  const provider = new FreeVideoProvider("test-token", async (url, init) => {
    strictEqual(url, `${HF_VIDEO.host}/gradio_api/upload`);
    strictEqual(init?.redirect, "error");
    strictEqual((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
    return new Response(JSON.stringify(["/tmp/gradio/own/reference.png"]));
  });
  deepStrictEqual(await provider.upload(new Uint8Array([1,2])), ["/tmp/gradio/own/reference.png"]);
});
test("sponsored S2V capability is dialogue-only and its video result stays on its own host", async () => {
  const base = { sha: HF_SPEECH.revision, host: HF_SPEECH.host, runtime: { stage: "RUNNING", hardware: { current: "cpu-basic" } } };
  deepStrictEqual(inspectSpaceMetadata(base, HF_SPEECH).capabilities, ["dialogue"]);
  const url = `${HF_SPEECH.host}/gradio_api/file=/tmp/gradio/speech.mp4`;
  strictEqual(await readVideoEvent(stream(`event: complete\ndata: [{"video":{"url":"${url}"}}]\n\n`), HF_SPEECH), url);
  throws(() => assertOutputUrl(url));
});
