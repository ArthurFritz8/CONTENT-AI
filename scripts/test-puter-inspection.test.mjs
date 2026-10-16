import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPuter} from './lib/puter-inspection.mjs';

const token = 'fixture-only-not-a-real-credential';
const identity = {uuid: '11111111-2222-4333-8444-555555555555', subscribed: false,
  email: 'private@example.invalid', auth_token: token, username: 'private'};
const usage = {allowanceInfo: {monthUsageAllowance: 25_000_000, remaining: 45_000_000,
  addons: {purchasedCredits: 30_000_000, consumedPurchaseCredits: 10_000_000}}};
const costs = {costs: [
  {source: 'driver:aiVideo/together-video-generation',
    usageType: 'together-video-generation:togetherai:Wan-AI/wan2.7-i2v:per-second', costValue: 2},
  {source: 'driver:aiChat/example', usageType: 'chat', costValue: 100},
]};
const now = () => new Date('2026-10-16T15:00:00Z');
const json = data => Response.json(data);
function mock(overrides = {}) {
  const calls = [];
  const values = {'/whoami': identity, '/metering/usage': usage, '/metering/allCosts': costs, ...overrides};
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.puter.com');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.body, undefined);
    calls.push(parsed.pathname);
    assert.ok(Object.hasOwn(values, parsed.pathname));
    const value = values[parsed.pathname];
    if (value instanceof Error) throw value;
    return value instanceof Response ? value : json(value);
  };
  return {calls, fetchImpl, now};
}

test('three fixed read endpoints, no inference; private identity never enters the report', async () => {
  const deps = mock();
  const report = await inspectPuter(token, deps);
  assert.deepEqual(deps.calls.sort(), ['/metering/allCosts', '/metering/usage', '/whoami']);
  const serialized = JSON.stringify(report);
  for (const secret of [token, identity.uuid, identity.email, identity.username]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(report.checked_at, now().toISOString());
  assert.match(report.account_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(report.production_ready, false);
  assert.equal(report.plan_verified, false);
  assert.equal(report.estimated_video_seconds, null);
  assert.equal(report.estimated_chapters, null);
});

test('purchased balance is never described as free or converted to episode capacity', async () => {
  const report = await inspectPuter(token, mock());
  assert.equal(report.wallet.remaining_combined_usd, 0.45);
  assert.equal(report.wallet.free_remaining, null);
  assert.equal(report.wallet.purchased_credits_reported, 30_000_000);
  assert.equal(report.wallet.renewal_at, null);
  assert.equal(report.wallet.outstanding_holds, 'not_reported');
  assert.equal(report.video_cost_observations.length, 1);
  assert.equal(report.video_cost_observations[0].raw_cost_value, 2);
  assert.equal(report.video_cost_observations[0].account_price_verified, false);
});

test('scaled credits are not dollars; zero balance is a valid observation', async () => {
  const report = await inspectPuter(token, mock({'/metering/usage': {
    allowanceInfo: {unit: 'credits', monthUsageAllowance: 5, remaining: 0},
  }}));
  assert.equal(report.wallet.unit, 'credits');
  assert.equal(report.wallet.remaining_combined_usd, null);
  assert.equal(report.wallet.remaining_combined_reported, 0);
  assert.equal(report.wallet.free_remaining, null);
});

test('unknown wallet shapes and units fail closed', async () => {
  for (const allowanceInfo of [null, {}, {remaining: 1},
    {remaining: -1, monthUsageAllowance: 1},
    {remaining: 1, monthUsageAllowance: '25'},
    {remaining: 1, monthUsageAllowance: 1, unit: 'new-unit'}]) {
    await assert.rejects(inspectPuter(token, mock({'/metering/usage': {allowanceInfo}})),
      error => ['unknown_allowance_schema', 'unknown_allowance_unit'].includes(error.code));
  }
});

test('HTTP failures are redacted and never retried', async () => {
  for (const [status, code] of [[401, 'invalid_token'], [402, 'account_access_blocked'],
    [403, 'access_denied'], [429, 'rate_limited'], [503, 'provider_http_error']]) {
    const deps = mock({'/whoami': new Response(token, {status})});
    await assert.rejects(inspectPuter(token, deps), error => error.code === code && !error.message.includes(token));
    assert.deepEqual(deps.calls, ['/whoami']);
  }
});

test('redirect, timeout and network errors cannot leak fetch exception details', async () => {
  const deps = mock({'/whoami': new Error(`network includes ${token}`)});
  await assert.rejects(inspectPuter(token, deps), error => error.code === 'provider_read_failed' && !error.message.includes(token));
  assert.equal(deps.calls.length, 1);
});

test('missing or malformed credentials make no HTTP call', async () => {
  let calls = 0;
  for (const value of [undefined, '', 'short', token + '\n', 'x'.repeat(8193)]) {
    await assert.rejects(inspectPuter(value, {fetchImpl: () => {calls++;}}),
      error => error.code === 'missing_or_invalid_token');
  }
  assert.equal(calls, 0);
});

test('empty catalog stays blocked and catalog updates change the fingerprint', async () => {
  const empty = await inspectPuter(token, mock({'/metering/allCosts': {costs: []}}));
  assert.ok(empty.blockers.includes('video_cost_catalog_empty'));
  const first = await inspectPuter(token, mock());
  const changed = structuredClone(costs); changed.costs[0].costValue = 3;
  const second = await inspectPuter(token, mock({'/metering/allCosts': changed}));
  assert.notEqual(first.catalog_sha256, second.catalog_sha256);
  assert.equal(second.production_ready, false);
  await assert.rejects(inspectPuter(token, mock({'/metering/allCosts': []})),
    error => error.code === 'unknown_cost_catalog_schema');
});

test('unknown identity, non-JSON and oversized responses fail before reporting success', async () => {
  for (const value of [{}, {uuid: token}, new Response('<html>login</html>'),
    new Response('x'.repeat(4 * 1024 * 1024 + 1), {headers: {'content-type': 'application/json'}}),
    new Response('invalid JSON ' + token, {headers: {'content-type': 'application/json'}})]) {
    await assert.rejects(inspectPuter(token, mock({'/whoami': value})), error =>
      ['unknown_account_schema', 'unexpected_response', 'response_too_large'].includes(error.code) && !error.message.includes(token));
  }
});
