/** Experimental source. Neither API access nor a finished clip approves continuity. */
import { createHash } from "node:crypto";
import { z } from "zod";

export const AURAY = Object.freeze({
  api: "https://api.auray.ai/v1", queue: "https://queue.auray.run",
  model: "auray-ai/minimax-h3/text-to-video", adapter: "auray-first-frame-audition-v1",
  seconds: 5, credits: 5, maxImageBytes: 12 * 1024 * 1024, maxVideoBytes: 64 * 1024 * 1024,
});
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const key = z.string().regex(/^[a-z0-9._-]{1,64}$/);
const accountSchema = z.object({
  object: z.literal("account"), id: z.string().uuid(), plan: z.string(), base: z.string(),
  promotion: z.unknown().nullable(), address_proved: z.boolean().nullable(),
  credits: z.object({ balance: integer.nullable(), plan_credits: integer.nullable(),
    purchased_credits: integer.nullable(), granted_credits: integer.nullable(),
    monthly_allowance: integer, period: z.string().regex(/^\d{4}-\d{2}$/) }),
  key: z.object({ id: z.string().min(1), scopes: z.array(z.string()), credit_ceiling: integer,
    credits_spent_period: integer }),
});
const plansSchema = z.object({ object: z.literal("list"), data: z.array(z.object({
  id: z.string(), base: z.string(), monthly_usd: z.number().nonnegative(), credits_per_month: integer,
  trial_days: integer, promotion: z.unknown().nullable(),
  limits: z.object({ billing: z.object({ trial_credits: integer }),
    video: z.object({ enabled: z.boolean(), max_duration_seconds: integer, max_concurrent: integer, tiers: z.array(z.string()) }),
    api: z.object({ may_generate: z.boolean() }) }),
})), price_keys: z.array(z.object({ key: z.string(), value: integer, address: z.string(), overridden: z.boolean() })) });

export class AurayError extends Error {
  readonly code: string;
  readonly acceptance: "none" | "unknown";
  constructor(code: string, acceptance: "none" | "unknown" = "none") {
    super(code); this.name = "AurayError"; this.code = code; this.acceptance = acceptance;
  }
}
export type AurayInspection = {
  provider: "auray", account_id: string | null, key_id: string | null, checked_at: string,
  period: string | null, monthly_allowance: number | null, plan_remaining: number | null,
  audition_remaining: number | null, audition_cost: 5, audition_seconds: 5,
  financially_eligible: boolean, blockers: string[], contract_sha256: string | null,
  production_ready: false, native_fps: null, native_resolution: null,
  dialogue_supported: false, editorial_status: "unvalidated",
};
export function missingAurayKey(now = new Date()): AurayInspection {
  return { provider: "auray", account_id: null, key_id: null, checked_at: now.toISOString(), period: null,
    monthly_allowance: null, plan_remaining: null, audition_remaining: null, audition_cost: 5,
    audition_seconds: 5, financially_eligible: false, blockers: ["missing_api_key"], contract_sha256: null,
    production_ready: false, native_fps: null, native_resolution: null, dialogue_supported: false, editorial_status: "unvalidated" };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const aurayHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const expectedInput = {
  prompt: { type: "string" }, duration_seconds: { type: "integer", default: 5 },
  tier: { type: "string", enum: ["fast"], default: "fast" },
  aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
  first_frame_path: { type: "string", "x-auray-encoding": "upload-path" },
  reference_image_paths: { type: "array", items: { type: "string", "x-auray-encoding": "upload-path" } },
  seed: { type: "integer" }, idempotency_key: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._-]{1,64}$" },
};
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !["description", "examples", "title"].includes(k)).map(([k,v]) => [k,semantic(v)]));
  return value;
}
export function inspectAurayContract(raw: unknown): string {
  const contract = z.object({ info: z.object({ title: z.literal(AURAY.model), version: z.literal("1.0.0"),
    "x-auray-hosted-by": z.literal("auray"), "x-auray-surface-enabled": z.literal(true),
    "x-auray-price": z.object({ kind: z.literal("quoted"), metered: z.literal(false) }) }),
    components: z.object({ schemas: z.object({ Input: z.object({ type: z.literal("object"),
      properties: z.record(z.unknown()), required: z.array(z.string()), additionalProperties: z.literal(false) }) }) }),
  }).safeParse(raw);
  if (!contract.success || canonical(semantic(contract.data.components.schemas.Input.properties)) !== canonical(expectedInput) ||
      canonical(contract.data.components.schemas.Input.required) !== '["prompt"]') throw new AurayError("contract_changed");
  // Identifies the API contract, not unpublished upstream weights or artistic quality.
  return aurayHash({ adapter: AURAY.adapter, model: AURAY.model, input: expectedInput, version: "1.0.0" });
}
export function inspectAurayAccount(plansRaw: unknown, accountRaw: unknown, contractRaw: unknown, now = new Date()): AurayInspection {
  const plans = plansSchema.safeParse(plansRaw), account = accountSchema.safeParse(accountRaw);
  if (!plans.success || !account.success) throw new AurayError("contract_changed");
  const contractHash = inspectAurayContract(contractRaw), a = account.data, c = a.credits;
  const report = { ...missingAurayKey(now), account_id: a.id, key_id: a.key.id, period: c.period,
    contract_sha256: contractHash, blockers: [] as string[] };
  const freePlans = plans.data.data.filter(p => p.id === "free" && p.base === "free");
  const free = freePlans.length === 1 ? freePlans[0] : undefined;
  if (!free || free.monthly_usd !== 0 || free.trial_days !== 0 || free.limits.billing.trial_credits !== 0 ||
      free.promotion !== null || free.credits_per_month <= 0) report.blockers.push("recurring_free_unverified");
  else report.monthly_allowance = free.credits_per_month;
  if (a.plan !== "free" || a.base !== "free" || a.promotion !== null) report.blockers.push("non_base_free_account");
  if (a.address_proved !== true) report.blockers.push("email_unverified");
  if (c.period !== now.toISOString().slice(0,7)) report.blockers.push("stale_credit_period");
  if (c.balance === null || c.plan_credits === null || c.purchased_credits === null || c.granted_credits === null ||
      c.balance !== c.plan_credits + c.purchased_credits + c.granted_credits) report.blockers.push("wallet_unverified");
  if (c.purchased_credits !== 0 || c.granted_credits !== 0 || c.monthly_allowance !== free?.credits_per_month)
    report.blockers.push("mixed_or_promotional_wallet");
  if (!free?.limits.api.may_generate || !free.limits.video.enabled || !free.limits.video.tiers.includes("fast") ||
      free.limits.video.max_duration_seconds < 5 || free.limits.video.max_concurrent < 1) report.blockers.push("free_video_unavailable");
  if (!a.key.scopes.some(s => ["video:write", "auray-ai-video:write"].includes(s)) ||
      !["jobs:read", "assets:read"].every(s => a.key.scopes.includes(s))) report.blockers.push("missing_scopes");
  // A ceiling of zero means unlimited, never zero spending. Auditions require a provider-enforced cap of five.
  if (a.key.credit_ceiling !== AURAY.credits || a.key.credits_spent_period > a.key.credit_ceiling) report.blockers.push("audition_key_cap_required");
  const prices = plans.data.price_keys.filter(p => p.key === "video.fast.5");
  if (prices.length !== 1 || prices[0]?.value !== AURAY.credits || prices[0]?.address !== "minimax-h3" || prices[0]?.overridden !== false)
    report.blockers.push("price_changed");
  if (report.blockers.length === 0) {
    report.plan_remaining = Math.min(c.balance!, c.plan_credits!, report.monthly_allowance!);
    report.audition_remaining = Math.min(report.plan_remaining, a.key.credit_ceiling - a.key.credits_spent_period);
    if (report.audition_remaining < AURAY.credits) report.blockers.push("insufficient_free_credits");
  }
  report.financially_eligible = report.blockers.length === 0;
  return report;
}

export const aurayAuditionSchema = z.object({
  version: z.literal("1.0"), kind: z.enum(["action", "reaction"]), prompt: z.string().min(40).max(2400),
  reference_path: z.string().min(1).max(500), reference_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  seconds: z.literal(5), aspect_ratio: z.enum(["9:16", "16:9"]), seed: integer.max(2147483647),
}).strict();
export type AurayAudition = z.infer<typeof aurayAuditionSchema>;
export function aurayAuditionKey(shot: AurayAudition, report: AurayInspection): string {
  if (!report.account_id || !report.period || !report.contract_sha256) throw new AurayError("inspection_required");
  return aurayHash({ shot, account: report.account_id, period: report.period, contract: report.contract_sha256 });
}
const jobSchema = z.object({ id: z.string(), job_id: z.string(), object: z.literal("job"), product: z.literal("video"),
  model: z.literal(AURAY.model), status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  settled: z.boolean(), credits_charged: integer, poll_after_seconds: integer.default(30),
  created_at: z.string().datetime({ offset: true }), upstream_lost: z.boolean().optional(),
});
export type AurayJob = z.infer<typeof jobSchema>;

/** Fixed HTTPS destinations; signed storage requests never receive the account bearer. */
export function aurayStorageUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new AurayError("unsafe_storage_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !/^[a-z0-9-]+\.(?:supabase\.co|r2\.cloudflarestorage\.com)$/.test(url.hostname)) throw new AurayError("unsafe_storage_url");
  return url;
}
export class AurayVideoProvider {
  readonly token: string | undefined;
  readonly fetcher: typeof fetch;
  constructor(token?: string, fetcher: typeof fetch = fetch) { this.token = token; this.fetcher = fetcher; }
  private async request(url: string, init: RequestInit = {}, mutation = false, bearer = true): Promise<Response> {
    if (bearer && !this.token) throw new AurayError("missing_api_key");
    if (bearer && !(url.startsWith(`${AURAY.api}/`) || url === `${AURAY.queue}/${AURAY.model}`)) throw new AurayError("unsafe_api_url");
    try {
      const response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25_000),
        headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${this.token}` } : {}), ...init.headers } });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? "access_denied" : response.status === 402 ? "quota_exhausted" :
          response.status === 404 ? "not_found" : response.status === 429 ? "rate_limited" : "request_rejected";
        throw new AurayError(response.status >= 500 ? "service_unavailable" : code, mutation && response.status >= 500 ? "unknown" : "none");
      }
      return response;
    } catch (error) { if (error instanceof AurayError) throw error; throw new AurayError("transport_failed", mutation ? "unknown" : "none"); }
  }
  private async bytes(response: Response, maximum: number): Promise<Uint8Array> {
    const reader = response.body?.getReader(); if (!reader) throw new AurayError("contract_changed");
    const chunks: Uint8Array[] = []; let size = 0;
    const deadline = Date.now() + 25_000;
    try {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([reader.read(),new Promise<never>((_,reject) => {
          timer = setTimeout(() => reject(new AurayError("transport_failed")),Math.max(1,deadline-Date.now()));
        })]).finally(() => { if (timer) clearTimeout(timer); });
        if (next.done) break;
        size += next.value.length; if (size > maximum) throw new AurayError("response_too_large"); chunks.push(next.value); }
    } catch (error) { void reader.cancel().catch(() => {}); if (error instanceof AurayError) throw error; throw new AurayError("transport_failed"); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; } return bytes;
  }
  private async json(url: string, init: RequestInit = {}, mutation = false, bearer = true): Promise<unknown> {
    const response = await this.request(url,init,mutation,bearer);
    try { return JSON.parse(new TextDecoder().decode(await this.bytes(response,4 * 1024 * 1024))); }
    catch { throw new AurayError("contract_changed", mutation ? "unknown" : "none"); }
  }
  async inspect(now = new Date()): Promise<AurayInspection> {
    if (!this.token) return missingAurayKey(now); // No account means no speculative capacity or HTTP calls.
    const [plans, account, contract] = await Promise.all([
      this.json(`${AURAY.api}/plans`, {}, false, false), this.json(`${AURAY.api}/me`),
      this.json(`${AURAY.api}/models/${AURAY.model}/openapi.json`, {}, false, false),
    ]);
    return inspectAurayAccount(plans,account,contract,now);
  }
  async upload(image: Uint8Array, requestKey: string, account: string): Promise<string> {
    key.parse(requestKey); z.string().uuid().parse(account);
    if (image.length > AURAY.maxImageBytes || Buffer.from(image.subarray(0,8)).toString("hex") !== "89504e470d0a1a0a") throw new AurayError("invalid_reference");
    const raw = await this.json(`${AURAY.api}/uploads`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: AURAY.model, content_type: "image/png", idempotency_key: requestKey }) },true);
    const ticket = z.object({ object: z.literal("upload"), address: z.literal(AURAY.model), path: z.literal(`${account}/api-${requestKey}.png`),
      upload_url: z.string(), max_bytes: integer, expires_at: z.string().datetime({ offset: true }) }).safeParse(raw);
    if (!ticket.success || ticket.data.max_bytes < image.length || Date.parse(ticket.data.expires_at) <= Date.now()) throw new AurayError("contract_changed");
    // Existing uploads can be reconciled by bytes, never blindly overwritten after an uncertain PUT.
    const readUrl = `${AURAY.api}/uploads/${ticket.data.path}?address=${encodeURIComponent(AURAY.model)}`;
    let exists = false;
    try {
      const read = z.object({ object: z.literal("upload"), path: z.literal(ticket.data.path), url: z.string() }).parse(await this.json(readUrl));
      const bytes = await this.bytes(await this.request(aurayStorageUrl(read.url).href,{},false,false), AURAY.maxImageBytes);
      if (!Buffer.from(bytes).equals(Buffer.from(image))) throw new AurayError("reference_conflict"); exists = true;
    } catch (error) { if (!(error instanceof AurayError) || error.code !== "not_found") throw new AurayError(error instanceof AurayError ? error.code : "contract_changed"); }
    if (!exists) await this.request(aurayStorageUrl(ticket.data.upload_url).href, { method: "PUT", headers: { "Content-Type": "image/png" }, body: Buffer.from(image) },true,false);
    return ticket.data.path;
  }
  async submit(shotRaw: AurayAudition, firstFramePath: string, requestKey: string, previous: AurayInspection): Promise<string> {
    const shot = aurayAuditionSchema.parse(shotRaw); key.parse(requestKey);
    const now = new Date();
    if (!previous.financially_eligible || now.getTime() - Date.parse(previous.checked_at) < 0 ||
        now.getTime() - Date.parse(previous.checked_at) > 300_000 || aurayAuditionKey(shot,previous) !== requestKey ||
        firstFramePath !== `${previous.account_id}/api-${requestKey}.png`) throw new AurayError("inspection_required");
    const current = await this.inspect(now);
    if (!current.financially_eligible || current.account_id !== previous.account_id || current.key_id !== previous.key_id ||
        current.period !== previous.period || current.contract_sha256 !== previous.contract_sha256) throw new AurayError("financial_gate_closed");
    const raw = await this.json(`${AURAY.queue}/${AURAY.model}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
      body: JSON.stringify({ prompt: shot.prompt, duration_seconds: 5, tier: "fast", aspect_ratio: shot.aspect_ratio,
        first_frame_path: firstFramePath, seed: shot.seed, idempotency_key: requestKey }) },true);
    const accepted = z.object({ request_id: z.literal(`video_${requestKey}`), job_id: z.literal(`video_${requestKey}`),
      model: z.literal(AURAY.model), product: z.literal("video"), credits_charged: integer.max(5), credits_quoted: z.literal(5) }).safeParse(raw);
    if (!accepted.success) throw new AurayError("acceptance_unresolved","unknown");
    return accepted.data.job_id;
  }
  async status(jobId: string): Promise<AurayJob> {
    if (!/^video_[a-f0-9]{64}$/.test(jobId)) throw new AurayError("invalid_job_id");
    const job = jobSchema.safeParse(await this.json(`${AURAY.api}/jobs/${jobId}`));
    if (!job.success || job.data.id !== jobId || job.data.job_id !== jobId || job.data.credits_charged > 5 || job.data.upstream_lost)
      throw new AurayError("job_unverified");
    return job.data; // Sanitized allowlist; never log provider errors, prompts or signed links.
  }
  async download(jobId: string): Promise<Uint8Array> {
    const job = await this.status(jobId);
    if (!job.settled || job.status !== "succeeded") throw new AurayError("job_not_ready");
    const raw = await this.json(`${AURAY.api}/jobs/${jobId}/assets`);
    const result = z.object({ id: z.literal(jobId), object: z.literal("asset_list"), product: z.literal("video"),
      assets: z.array(z.object({ kind: z.string(), content_type: z.string(), bytes: integer.nullable(), url: z.string() })) }).safeParse(raw);
    const videos = result.success ? result.data.assets.filter(a => a.kind === "video") : [];
    const asset = videos.length === 1 ? videos[0] : undefined;
    if (!asset || asset.content_type !== "video/mp4" || asset.bytes === null || asset.bytes <= 0 || asset.bytes > AURAY.maxVideoBytes)
      throw new AurayError("asset_unverified");
    const bytes = await this.bytes(await this.request(aurayStorageUrl(asset.url).href,{},false,false),AURAY.maxVideoBytes);
    if (bytes.length !== asset.bytes) throw new AurayError("asset_size_mismatch");
    return bytes;
  }
}
