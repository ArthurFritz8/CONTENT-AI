import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws, rejects, ok } from "node:assert";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { AURAY, AurayError, AurayVideoProvider, aurayAuditionKey, aurayAuditionSchema,
  aurayStorageUrl, inspectAurayAccount, inspectAurayContract } from "./auray-video-provider.ts";

const accountId = "00000000-0000-4000-8000-000000000099";
const now = new Date("2026-10-09T15:00:00Z");
function fixtures(date = now) {
  return {
    plans: { object: "list", data: [{ id: "free", base: "free", monthly_usd: 0, credits_per_month: 50,
      trial_days: 0, promotion: null, limits: { billing: { trial_credits: 0 },
        video: { enabled: true, max_duration_seconds: 15, max_concurrent: 1, tiers: ["fast"] }, api: { may_generate: true } } }],
      price_keys: [{ key: "video.fast.5", value: 5, address: "minimax-h3", overridden: false }] },
    account: { object: "account", id: accountId, plan: "free", base: "free", promotion: null, address_proved: true,
      credits: { balance: 50, plan_credits: 50, purchased_credits: 0, granted_credits: 0, monthly_allowance: 50, period: date.toISOString().slice(0,7) },
      key: { id: "test-key-id", scopes: ["video:write", "jobs:read", "assets:read"], credit_ceiling: 5, credits_spent_period: 0 } },
    contract: { info: { title: AURAY.model, version: "1.0.0", "x-auray-hosted-by": "auray", "x-auray-surface-enabled": true,
      "x-auray-price": { kind: "quoted", metered: false } }, components: { schemas: { Input: {
        type: "object", required: ["prompt"], additionalProperties: false, properties: {
          prompt: { type: "string", description: "Editorial text is not a contract change" }, duration_seconds: { type: "integer", default: 5 },
          tier: { type: "string", enum: ["fast"], default: "fast" }, aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
          first_frame_path: { type: "string", "x-auray-encoding": "upload-path" },
          reference_image_paths: { type: "array", items: { type: "string", "x-auray-encoding": "upload-path" } },
          seed: { type: "integer", examples: [1] }, idempotency_key: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]{1,64}$" },
        } } } } },
  };
}
function report(f = fixtures(), date = now) { return inspectAurayAccount(f.plans, f.account, f.contract,date); }
const shot = aurayAuditionSchema.parse({ version: "1.0", kind: "reaction", prompt: "Preserve the reference characters, hands and eyes. A silent natural reaction with closed mouths.",
  reference_path: "own/reference.png", reference_sha256: "1".repeat(64), seconds: 5, aspect_ratio: "9:16", seed: 7 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value),{ status, headers: { "Content-Type": "application/json" } });
function inspector(f = fixtures(new Date()), mutations: string[] = [], submit?: () => Promise<Response>): typeof fetch {
  return async (url, init) => {
    const address = String(url);
    if (init?.method === "POST") { mutations.push(address); if (submit) return submit(); throw new Error("unexpected submission"); }
    strictEqual(init?.redirect,"error");
    if (address.endsWith("/plans")) { ok(!new Headers(init?.headers).has("Authorization")); return json(f.plans); }
    if (address.endsWith("/me")) { strictEqual(new Headers(init?.headers).get("Authorization"),"Bearer dummy"); return json(f.account); }
    if (address.endsWith("/openapi.json")) return json(f.contract);
    throw new Error("unexpected URL");
  };
}

test("recurring base Free wallet is separate from artistic approval and chapter capacity", () => {
  const r = report(); strictEqual(r.monthly_allowance,50); strictEqual(r.plan_remaining,50);
  strictEqual(r.audition_remaining,5); strictEqual(r.financially_eligible,true);
  strictEqual(r.production_ready,false); strictEqual(r.dialogue_supported,false); strictEqual(r.native_fps,null);
});
test("paid, temporary, mixed, stale or unverified balances cannot fund a free audition", () => {
  const cases = [
    (f: ReturnType<typeof fixtures>) => { f.plans.data[0]!.monthly_usd = 1; },
    (f: ReturnType<typeof fixtures>) => { f.plans.data[0]!.trial_days = 30; },
    (f: ReturnType<typeof fixtures>) => { f.account.plan = "pro"; },
    (f: ReturnType<typeof fixtures>) => { f.account.credits.granted_credits = 5; f.account.credits.balance += 5; },
    (f: ReturnType<typeof fixtures>) => { f.account.credits.purchased_credits = 5; f.account.credits.balance += 5; },
    (f: ReturnType<typeof fixtures>) => { f.account.credits.period = "2026-09"; },
    (f: ReturnType<typeof fixtures>) => { f.account.credits.monthly_allowance = 100; },
    (f: ReturnType<typeof fixtures>) => { f.account.address_proved = false; },
    (f: ReturnType<typeof fixtures>) => { f.account.key.credit_ceiling = 0; },
    (f: ReturnType<typeof fixtures>) => { f.account.key.credit_ceiling = 50; },
    (f: ReturnType<typeof fixtures>) => { f.account.key.scopes = ["assets:read"]; },
    (f: ReturnType<typeof fixtures>) => { f.plans.price_keys[0]!.value = 6; },
    (f: ReturnType<typeof fixtures>) => { f.plans.data[0]!.limits.api.may_generate = false; },
  ];
  for (const change of cases) { const f = fixtures(); change(f); const r = report(f);
    strictEqual(r.financially_eligible,false); strictEqual(r.audition_remaining,null); ok(r.blockers.length > 0); }
  const f = fixtures(); f.account.key.credits_spent_period = 5;
  strictEqual(report(f).audition_remaining,0); deepStrictEqual(report(f).blockers,["insufficient_free_credits"]);
  throws(() => inspectAurayAccount(f.plans, { ...f.account, credits: {} }, f.contract,now), /contract_changed/);
  strictEqual(inspectAurayAccount(f.plans,{ ...f.account,promotion: { unlimited: true } },f.contract,now).financially_eligible,false);
});
test("semantic contract changes close the source; prose changes do not imply pinned model weights", () => {
  const f = fixtures(); const hash = inspectAurayContract(f.contract);
  f.contract.components.schemas.Input.properties.prompt.description = "Different prose";
  strictEqual(inspectAurayContract(f.contract),hash);
  f.contract.components.schemas.Input.properties.tier.enum = ["standard"];
  throws(() => inspectAurayContract(f.contract), /contract_changed/);
  throws(() => aurayAuditionSchema.parse({ ...shot, kind: "dialogue", audio_path: "voice.wav" }));
  throws(() => aurayAuditionSchema.parse({ ...shot, seconds: 15 }));
});
test("missing key makes no HTTP call and cannot advertise capacity", async () => {
  const r = await new AurayVideoProvider(undefined,async () => { throw new Error("must not fetch"); }).inspect();
  deepStrictEqual(r.blockers,["missing_api_key"]); strictEqual(r.monthly_allowance,null);
});
test("rechecks account immediately before POST and never falls back after ambiguous acceptance", async () => {
  const f = fixtures(new Date()), previous = report(f,new Date()), id = aurayAuditionKey(shot,previous), calls: string[] = [];
  f.account.key.credits_spent_period = 5;
  await rejects(new AurayVideoProvider("dummy",inspector(f,calls)).submit(shot,`${accountId}/api-${id}.png`,id,previous), /financial_gate_closed/);
  deepStrictEqual(calls,[]); f.account.key.credits_spent_period = 0;
  const provider = new AurayVideoProvider("dummy",inspector(f,calls,async () => { throw new Error("private credential must not surface"); }));
  await rejects(provider.submit(shot,`${accountId}/api-${id}.png`,id,previous), e => e instanceof AurayError && e.code === "transport_failed" && e.acceptance === "unknown" && !e.message.includes("credential"));
  strictEqual(calls.length,1);
});
test("exact bounded payload and deterministic job ID; malformed successful response stays unresolved", async () => {
  const f = fixtures(new Date()), previous = report(f,new Date()), id = aurayAuditionKey(shot,previous), calls: string[] = [];
  const fetcher = inspector(f,calls);
  const provider = new AurayVideoProvider("dummy",async (url,init) => {
    if (init?.method !== "POST") return fetcher(url,init);
    strictEqual(String(url),`${AURAY.queue}/${AURAY.model}`);
    const body = JSON.parse(String(init.body)); strictEqual(body.duration_seconds,5); strictEqual(body.tier,"fast");
    strictEqual(body.first_frame_path,`${accountId}/api-${id}.png`); strictEqual(body.idempotency_key,id);
    strictEqual(new Headers(init.headers).get("Idempotency-Key"),id); ok(!("audio_url" in body));
    return json({ request_id: `video_${id}`, job_id: `video_${id}`, model: AURAY.model, product: "video", credits_charged: 5, credits_quoted: 5 },202);
  });
  strictEqual(await provider.submit(shot,`${accountId}/api-${id}.png`,id,previous),`video_${id}`);
  await rejects(new AurayVideoProvider("dummy",inspector(f,[],async () => json({ secret_url: "private" }))).submit(shot,`${accountId}/api-${id}.png`,id,previous),
    e => e instanceof AurayError && e.code === "acceptance_unresolved" && e.acceptance === "unknown");
  await rejects(provider.submit(shot,`${accountId}/api-${id}.png`,id,{ ...previous,checked_at: new Date(Date.now()-301_000).toISOString() }),/inspection_required/);
});
test("signed storage destinations refuse redirects, IPs, lookalikes and user credentials", () => {
  ok(aurayStorageUrl("https://project.supabase.co/storage/v1/object/x?token=signature"));
  for (const url of ["http://project.supabase.co/a", "https://127.0.0.1/a", "https://project.supabase.co.evil.test/a",
    "https://user:password@project.supabase.co/a", "https://project.supabase.co:444/a", "https://evil.test/a"])
    throws(() => aurayStorageUrl(url),/unsafe_storage_url/);
});
test("upload verifies account path; signed PUT has no bearer and resume reuses identical bytes", async () => {
  const id = "a".repeat(64), path = `${accountId}/api-${id}.png`;
  const png = Buffer.from("89504e470d0a1a0a00","hex"); let exists = false, puts = 0;
  const provider = new AurayVideoProvider("dummy",async (url,init) => {
    if (String(url).endsWith("/uploads")) return json({ object: "upload", address: AURAY.model,path,
      upload_url: "https://project.supabase.co/put?token=signature", max_bytes: 100, expires_at: new Date(Date.now()+60_000).toISOString() });
    if (String(url).includes("/uploads/")) return exists ? json({ object: "upload",path,url: "https://project.supabase.co/read?token=signature" }) : json({},404);
    strictEqual(init?.redirect,"error"); ok(!new Headers(init?.headers).has("Authorization"));
    if (init?.method === "PUT") { puts++; exists = true; return new Response(null,{ status: 200 }); }
    return new Response(png);
  });
  strictEqual(await provider.upload(png,id,accountId),path); strictEqual(await provider.upload(png,id,accountId),path); strictEqual(puts,1);
});
test("polling/download never submit a job; settlement and exact asset size precede acceptance", async () => {
  const id = `video_${"b".repeat(64)}`; let settled = false;
  const provider = new AurayVideoProvider("dummy",async (url,init) => {
    ok(!init?.method || init.method === "GET");
    if (String(url).endsWith("/assets")) return json({ id,object: "asset_list",product: "video",assets: [
      { kind: "video", content_type: "video/mp4", bytes: 3,url: "https://project.supabase.co/video?token=signature" }] });
    if (String(url).startsWith("https://project.supabase.co/")) { ok(!new Headers(init?.headers).has("Authorization")); return new Response(new Uint8Array([1,2,3])); }
    return json({ id,job_id:id,object:"job",product:"video",model:AURAY.model,status:"succeeded",settled,
      credits_charged:5,poll_after_seconds:0,created_at:now.toISOString(),error:"Do not retain private errors" });
  });
  await rejects(provider.download(id),/job_not_ready/); settled = true;
  deepStrictEqual(await provider.download(id),new Uint8Array([1,2,3])); ok(!("error" in await provider.status(id)));
});

test("HTTP refusals and uncertain service errors carry only sanitized reconciliation signals", async () => {
  const f = fixtures(new Date()), previous = report(f,new Date()), id = aurayAuditionKey(shot,previous);
  for (const status of [402,422,429,503]) {
    const calls: string[] = [];
    const p = new AurayVideoProvider("dummy",inspector(f,calls,async () => json({ error:"private signed-link and key" },status)));
    await rejects(p.submit(shot,`${accountId}/api-${id}.png`,id,previous),e => e instanceof AurayError &&
      e.acceptance === (status === 503 ? "unknown" : "none") && !e.message.includes("private"));
    strictEqual(calls.length,1);
  }
});
test("unknown jobs, upstream loss and changed output identity remain unresolved", async () => {
  const id = `video_${"c".repeat(64)}`;
  const base = { id,job_id:id,object:"job",product:"video",model:AURAY.model,status:"running",settled:false,
    credits_charged:5,poll_after_seconds:30,created_at:now.toISOString() };
  for (const change of [{ job_id:`video_${"d".repeat(64)}` },{ upstream_lost:true },{ credits_charged:6 },{ model:"other/model" }])
    await rejects(new AurayVideoProvider("dummy",async () => json({ ...base,...change })).status(id),/job_unverified/);
  await rejects(new AurayVideoProvider("dummy",async () => json({},404)).status(id),/not_found/);
});
test("upload refuses another account and never overwrites a different reference", async () => {
  const id = "e".repeat(64),path = `${accountId}/api-${id}.png`, png = Buffer.from("89504e470d0a1a0a00","hex"); let put = false;
  const p = new AurayVideoProvider("dummy",async (url,init) => {
    if (String(url).endsWith("/uploads")) return json({ object:"upload",address:AURAY.model,path,
      upload_url:"https://project.supabase.co/put",max_bytes:100,expires_at:new Date(Date.now()+60_000).toISOString() });
    if (String(url).includes("/uploads/")) return json({ object:"upload",path,url:"https://project.supabase.co/read" });
    if (init?.method === "PUT") put = true;
    return new Response(new Uint8Array([9,9]));
  });
  await rejects(p.upload(png,id,accountId),/reference_conflict/); strictEqual(put,false);
  await rejects(p.upload(png,id,"00000000-0000-4000-8000-000000000098"),/contract_changed/); strictEqual(put,false);
});
test("truncated downloads and malformed success bodies never become approved files", async () => {
  const id = `video_${"f".repeat(64)}`;
  const p = new AurayVideoProvider("dummy",async url => {
    if (String(url).endsWith("/assets")) return json({ id,object:"asset_list",product:"video",assets:[
      { kind:"video",content_type:"video/mp4",bytes:4,url:"https://project.supabase.co/video" }] });
    if (String(url).startsWith("https://project.supabase.co/")) return new Response(new Uint8Array([1]));
    return json({ id,job_id:id,object:"job",product:"video",model:AURAY.model,status:"succeeded",settled:true,
      credits_charged:5,created_at:now.toISOString() });
  });
  await rejects(p.download(id),/asset_size_mismatch/);
});

test("actual CLI saves before submit, resumes a single job, verifies FFmpeg output and reuses cache without HTTP", async () => {
  const root = resolve(import.meta.dirname,"../../.."), temporary = await mkdtemp(join(tmpdir(),"content-ai-auray-test-"));
  const sandbox = join(root,"output",`auray-cli-test-${randomUUID()}`);
  try {
    const reference = join(temporary,"reference.png"), video = join(temporary,"sample.mp4"), log = join(temporary,"http.jsonl");
    const image = await sharp({ create: { width:90,height:160,channels:3,background:"#a04d38" } }).png().toBuffer(); await writeFile(reference,image);
    const generation = spawnSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=red:s=90x160:r=30:d=5",
      "-c:v","libx264","-pix_fmt","yuv420p","-y",video],{ encoding:"utf8",timeout:30_000,windowsHide:true });
    strictEqual(generation.status,0,"offline FFmpeg fixture must encode");
    const plan = join(temporary,"plan.json"), preload = join(temporary,"preload.mjs");
    await writeFile(plan,JSON.stringify({ ...shot,reference_path:reference,reference_sha256:createHash("sha256").update(image).digest("hex"),seed:Math.floor(Math.random()*2147483647) }));
    const f = fixtures(new Date());
    await writeFile(preload,`
      import { readFileSync,appendFileSync } from 'node:fs';
      const fixture = ${JSON.stringify(f)};
      const log = ${JSON.stringify(log)}, video = ${JSON.stringify(video)};
      const api = ${JSON.stringify(AURAY.api)}, model = ${JSON.stringify(AURAY.model)};
      const json = (body,status=200) => new Response(JSON.stringify(body),{status});
      globalThis.fetch = async (url,init={}) => {
        url = String(url); appendFileSync(log,JSON.stringify({url,method:init.method??'GET'})+'\\n');
        if (url.endsWith('/plans')) return json(fixture.plans);
        if (url.endsWith('/me')) return json(fixture.account);
        if (url.endsWith('/openapi.json')) return json(fixture.contract);
        if (url.endsWith('/uploads') && init.method === 'POST') {
          const body = JSON.parse(init.body); return json({object:'upload',address:model,
            path:fixture.account.id+'/api-'+body.idempotency_key+'.png',upload_url:'https://project.supabase.co/put',
            max_bytes:1000000,expires_at:new Date(Date.now()+60000).toISOString()});
        }
        if (url.includes('/uploads/')) return json({},404);
        if (url === 'https://project.supabase.co/put') return new Response(null,{status:200});
        if (url.startsWith('https://queue.auray.run/') && init.method === 'POST') {
          const body = JSON.parse(init.body), id = 'video_'+body.idempotency_key;
          // Durable checkpoint must exist BEFORE the queue sees this POST.
          const state = JSON.parse(readFileSync(${JSON.stringify(sandbox)}+'/'+body.idempotency_key+'/state.json','utf8'));
          if (state.phase !== 'submission_started' || state.job_id !== id) throw new Error('checkpoint absent');
          return json({request_id:id,job_id:id,model,product:'video',credits_charged:5,credits_quoted:5},202);
        }
        if (url.endsWith('/assets')) {
          const id = url.split('/').at(-2), bytes = readFileSync(video).length;
          return json({id,object:'asset_list',product:'video',assets:[{kind:'video',content_type:'video/mp4',bytes,url:'https://project.supabase.co/sample'}]});
        }
        if (url === 'https://project.supabase.co/sample') return new Response(readFileSync(video));
        if (url.startsWith(api+'/jobs/')) {
          const id = url.split('/').at(-1); return json({id,job_id:id,object:'job',product:'video',model,
            status:process.env.AURAY_TEST_COMPLETE === 'yes' ? 'succeeded' : 'queued',
            settled:process.env.AURAY_TEST_COMPLETE === 'yes',credits_charged:5,poll_after_seconds:30,created_at:new Date().toISOString()});
        }
        throw new Error('unmocked HTTP is forbidden');
      };
    `);
    const execute = (args: string[], complete = false) => spawnSync(process.execPath,["--experimental-strip-types","--import",pathToFileURL(preload).href,
      join(root,"scripts","render-auray-story-shot.mts"),...args],{ cwd:root,encoding:"utf8",timeout:45_000,windowsHide:true,
        env:{ ...process.env,AURAY_API_KEY:"dummy",AURAY_TEST_COMPLETE:complete ? "yes" : "no",CONTENT_AI_AURAY_OUTPUT_DIR:sandbox } });
    const submitted = execute(["--run",plan,"--allow-free-audition"]);
    strictEqual(submitted.status,0,submitted.stderr); const waiting = JSON.parse(submitted.stdout.trim()); strictEqual(waiting.status,"queued");
    const checkpoint = waiting.checkpoint as string;
    const state = JSON.parse(await readFile(checkpoint,"utf8")); strictEqual(state.phase,"waiting");
    const resumed = execute(["--resume",checkpoint],true); strictEqual(resumed.status,0,resumed.stderr);
    const result = JSON.parse(resumed.stdout.trim()); strictEqual(result.status,"review_pending"); strictEqual(result.production_ready,false);
    strictEqual(result.encoded_fps,30); strictEqual(result.decoded_frames,150); strictEqual(result.dialogue_approved,false);
    const calls = (await readFile(log,"utf8")).trim().split("\n").map(line => JSON.parse(line));
    strictEqual(calls.filter(c => c.method === "POST" && c.url.startsWith(AURAY.queue)).length,1);
    const before = await readFile(log,"utf8"), cached = execute(["--resume",checkpoint],true);
    strictEqual(cached.status,0,cached.stderr); strictEqual(await readFile(log,"utf8"),before);
    await writeFile(result.file,"corrupt cached output"); const corrupted = execute(["--resume",checkpoint],true);
    strictEqual(corrupted.status,1); ok(corrupted.stderr.includes("cached_output_changed")); strictEqual(await readFile(log,"utf8"),before);
  } finally {
    // Verify absolute confinement before recursive Windows cleanup. Never remove the shared output directory.
    const parent = join(root,"output");
    ok(sandbox.startsWith(parent+"\\") || sandbox.startsWith(parent+"/"));
    ok(/^auray-cli-test-[a-f0-9-]{36}$/.test(sandbox.slice(parent.length+1)));
    await rm(sandbox,{ recursive:true,force:true });
    ok(temporary.startsWith(join(tmpdir(),"content-ai-auray-test-"))); await rm(temporary,{ recursive:true,force:true });
  }
});
