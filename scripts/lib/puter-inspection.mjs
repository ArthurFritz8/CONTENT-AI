/** Account discovery only. This module has no generation or billing mutation endpoint. */
import { createHash } from 'node:crypto';

const ORIGIN = 'https://api.puter.com';
const MAX_BYTES = 4 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export class PuterInspectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function jsonResponse(response) {
  if (!response.ok) {
    const code = ({401: 'invalid_token', 402: 'account_access_blocked', 403: 'access_denied', 429: 'rate_limited'})[response.status];
    throw new PuterInspectionError(code ?? 'provider_http_error');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new PuterInspectionError('unexpected_response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new PuterInspectionError('unexpected_response');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new PuterInspectionError('response_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PuterInspectionError('unexpected_response'); }
}

/** Explicit scaled credits stay credits. No conversion from a deployment's default plan. */
function walletObservation(data) {
  const info = record(data) && data.allowanceInfo;
  if (!record(info) || !amount(info.monthUsageAllowance) || !amount(info.remaining)) {
    throw new PuterInspectionError('unknown_allowance_schema');
  }
  const unit = info.unit === undefined ? 'microcents' : info.unit;
  if (!['microcents', 'credits'].includes(unit)) throw new PuterInspectionError('unknown_allowance_unit');
  // `remaining` includes purchased credits; it is NOT the remaining free allowance.
  const addons = record(info.addons) ? info.addons : {};
  const bought = amount(addons.purchasedCredits) ? addons.purchasedCredits : null;
  const consumed = amount(addons.consumedPurchaseCredits) ? addons.consumedPurchaseCredits : null;
  return {
    unit,
    monthly_allowance_reported: info.monthUsageAllowance,
    remaining_combined_reported: info.remaining,
    remaining_combined_usd: unit === 'microcents' ? info.remaining / 100_000_000 : null,
    purchased_credits_reported: bought,
    consumed_purchased_credits_reported: consumed,
    free_remaining: null,
    renewal_at: null,
    outstanding_holds: 'not_reported',
  };
}

function videoCostObservations(data) {
  if (!record(data) || !Array.isArray(data.costs) || data.costs.length > 50_000) {
    throw new PuterInspectionError('unknown_cost_catalog_schema');
  }
  return data.costs.filter(row => record(row) &&
    typeof row.source === 'string' && /^driver:aiVideo\/[a-z0-9-]{1,100}$/.test(row.source) &&
    typeof row.usageType === 'string' && /^[a-zA-Z0-9:_.\/-]{1,400}$/.test(row.usageType)
  ).map(row => ({
    source: row.source,
    usage_type: row.usageType,
    // costValue alone has no currency declaration. Preserve as observation, never a quote.
    raw_cost_value: amount(row.costValue) ? row.costValue : null,
    microcents_per_unit: amount(row.ucentsPerUnit) ? row.ucentsPerUnit : null,
    credits_per_unit: amount(row.creditsPerUnit) ? row.creditsPerUnit : null,
    account_price_verified: false,
  })).sort((a,b) => a.usage_type.localeCompare(b.usage_type));
}

export async function inspectPuter(token, {fetchImpl = fetch, now = () => new Date()} = {}) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 8192 || /\s|[\x00-\x1f\x7f]/.test(token)) {
    throw new PuterInspectionError('missing_or_invalid_token');
  }
  const read = async path => {
    try {
      return await jsonResponse(await fetchImpl(ORIGIN + path, {
        method: 'GET',
        headers: {Authorization: `Bearer ${token}`, Accept: 'application/json'},
        redirect: 'error', signal: AbortSignal.timeout(20_000),
      }));
    } catch (error) {
      if (error instanceof PuterInspectionError) throw error;
      // Never echo provider bodies, fetch errors, headers, token, or account details.
      throw new PuterInspectionError('provider_read_failed');
    }
  };
  const identity = await read('/whoami');
  if (!record(identity) || typeof identity.uuid !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity.uuid)) {
    throw new PuterInspectionError('unknown_account_schema');
  }
  const results = await Promise.allSettled([read('/metering/usage'), read('/metering/allCosts')]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const wallet = walletObservation(results[0].value);
  const costs = videoCostObservations(results[1].value);
  return {
    version: 1, provider: 'puter', checked_at: now().toISOString(), mode: 'read_only',
    account_fingerprint: createHash('sha256').update(`puter:${identity.uuid}`).digest('hex'),
    subscribed_flag_reported: typeof identity.subscribed === 'boolean' ? identity.subscribed : null,
    plan_verified: false,
    wallet,
    video_cost_observations: costs,
    catalog_sha256: createHash('sha256').update(JSON.stringify(costs)).digest('hex'),
    production_ready: false, estimated_video_seconds: null, estimated_chapters: null,
    blockers: ['free_plan_entitlement_unverified', 'account_video_price_unverified',
      'video_capabilities_unverified', 'quality_review_required',
      ...(costs.length ? [] : ['video_cost_catalog_empty'])],
  };
}
