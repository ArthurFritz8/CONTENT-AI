import { test } from "node:test";
import { strictEqual, deepStrictEqual, throws, rejects, ok } from "node:assert";
import { HF_VIDEO, HF_SPEECH, HF_LIPSYNC, assertEndpoint, assertOutputUrl, inspectSpaceMetadata, readVideoEvent, FreeVideoProvider, freeVideoQuotaLedger } from "./free-video-provider.ts";

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

test("MuseTalk shares the ZeroGPU quota and cannot be counted as a new allowance", () => {
  const base = { sha: HF_LIPSYNC.revision, host: HF_LIPSYNC.host, runtime: { stage: "RUNNING", hardware: { current: "zero-a10g" } } };
  const capacity = inspectSpaceMetadata(base, HF_LIPSYNC);
  deepStrictEqual(capacity.capabilities, ["dialogue"]);
  strictEqual(capacity.output_fps, 25);
  strictEqual(capacity.quota_group, inspectSpaceMetadata(null).quota_group);
  strictEqual(freeVideoQuotaLedger(HF_LIPSYNC), freeVideoQuotaLedger(HF_VIDEO));
  ok(freeVideoQuotaLedger(HF_LIPSYNC) !== freeVideoQuotaLedger(HF_SPEECH));
});

test("MuseTalk endpoint and multipart result reject mismatched contracts", async () => {
  const parameters = ["audio_path", "video_path", "bbox_shift", "extra_margin", "parsing_mode", "left_cheek_width", "right_cheek_width"].map(parameter_name => ({ parameter_name }));
  assertEndpoint({ named_endpoints: { "/generate": { parameters, api_visibility: null } } }, HF_LIPSYNC);
  throws(() => assertEndpoint({ named_endpoints: { "/generate": { parameters: [...parameters].reverse() } } }, HF_LIPSYNC));
  throws(() => assertEndpoint({ named_endpoints: { "/generate": { parameters, api_visibility: "private" } } }, HF_LIPSYNC));
  const url = `${HF_LIPSYNC.host}/gradio_api/file=/tmp/gradio/lipsync.mp4`;
  strictEqual(await readVideoEvent(stream(`event: complete\ndata: [{"video":{"url":"${url}"}},"bbox range"]\n\n`), HF_LIPSYNC), url);
  await rejects(readVideoEvent(stream(`event: complete\ndata: [{"video":{"url":"${HF_VIDEO.host}/gradio_api/file=/tmp/gradio/clip.mp4"}},"bbox"]\n\n`), HF_LIPSYNC), /contract_changed/);
});

test("MuseTalk submits audio before image and never claims prompt/seed control", async () => {
  let calls = 0;
  const provider = new FreeVideoProvider(undefined, async (url, init) => {
    calls++;
    strictEqual(url, `${HF_LIPSYNC.host}/gradio_api/call/generate`);
    strictEqual(init?.redirect, "error");
    const file = (path: string) => ({ path, meta: { _type: "gradio.FileData" } });
    deepStrictEqual(JSON.parse(String(init?.body)).data, [file("/tmp/gradio/voice.wav"), file("/tmp/gradio/image.png"), 0, 10, "jaw", 90, 90]);
    return new Response(JSON.stringify({ event_id: "a".repeat(32) }));
  }, HF_LIPSYNC);
  const shot = { version: "1.0.0", id: "mouth", kind: "dialogue", reference_path: "ref.png", reference_sha256: "a".repeat(64),
    prompt: "Editorial prompt must not be sent to the mouth-only model", seconds: 3.25, seed: 7, audio_sha256: "b".repeat(64),
    quality: "preview", min_short_edge: 480, min_output_fps: 25 } as const;
  strictEqual(await provider.submit(shot, ["/tmp/gradio/image.png", "/tmp/gradio/voice.wav"]), "a".repeat(32));
  await rejects(provider.submit({ ...shot, kind: "action" }, ["/tmp/gradio/image.png", "/tmp/gradio/voice.wav"]), /contract_changed/);
  strictEqual(calls, 1);
});
