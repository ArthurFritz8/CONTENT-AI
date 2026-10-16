import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceCnapsAudition, admitCnapsAudition, validateAuditionDetail, NODES, CONNECTIONS,
  PARAMETERS, SELECTION_SHA, REFERENCE_SHA, PLAN_SHA, uploadedReferenceUrl} from './lib/cnaps-malu-audition.mjs';
import {connectCnapsAudition, cnapsToolErrorCode, fetchCnapsMedia} from './lib/cnaps-audition-client.mjs';
import {CnapsInspectionError} from './lib/cnaps-inspection.mjs';

const account = {provider: 'cnaps', account_fingerprint: 'a'.repeat(64), free_plan_reported: true,
  account_plan_verified: true, account_plan_reported: 'free',
  usage_observation: {usage_percent: 0, is_unlimited: false, reset_period_hours: 5},
  reference_model_observation: {selection_sha256: SELECTION_SHA}};
const flow = {flow_id: 'fixture-owned-flow', nodes: NODES, connections: CONNECTIONS,
  permission: 'private', access_role: 'owner', state: 'activated', status: ''};
function harness(overrides = {}) {
  let state = null;
  const calls = [];
  const deps = {load: async () => structuredClone(state),
    save: async value => { state = structuredClone(value); },
    referenceBytes: async () => Buffer.from('fixture image'), hashBytes: () => REFERENCE_SHA,
    transferReference: async () => 'https://private.example.invalid/expiring-reference',
    verifyRemoteReference: async () => {}, inspect: async () => structuredClone(account),
    client: {call: async (name, args) => {
      calls.push({name, args, phase: state?.phase, attempted: state?.generation_attempted});
      if (name === 'preview_flow') return {compatible: true};
      if (name === 'create_flow') { assert.equal(state.phase, 'create_intent'); assert.equal(args.run, false); return {flow_id: flow.flow_id}; }
      if (name === 'get_flow') return args.view === 'detail' ? structuredClone(flow) : {state: 'running'};
      if (name === 'upload_file') { assert.equal(state.phase, 'upload_intent'); return {file_url: 'https://storage.googleapis.com/fixture/malu.png'}; }
      if (name === 'run_flow') { assert.equal(state.phase, 'generation_unknown'); assert.equal(state.generation_attempted, true); return {state: 'running'}; }
      assert.fail('unexpected tool');
    }}, ...overrides};
  return {deps, calls, state: () => structuredClone(state), set: value => { state = structuredClone(value); }};
}

test('one fixed graph, intents before all writes, one generation; repeated run/resume is read-only', async () => {
  const h = harness();
  assert.equal((await advanceCnapsAudition('prepare', h.deps)).phase, 'created');
  assert.equal(h.calls.some(call => call.name === 'run_flow'), false);
  const submitted = await advanceCnapsAudition('run', h.deps);
  assert.equal(submitted.phase, 'submitted');
  const run = h.calls.find(call => call.name === 'run_flow');
  assert.deepEqual(Object.keys(JSON.parse(run.args.inputs)), ['1000', '1001']);
  await advanceCnapsAudition('run', h.deps);
  await advanceCnapsAudition('resume', h.deps);
  assert.equal(h.calls.filter(call => call.name === 'create_flow').length, 1);
  assert.equal(h.calls.filter(call => call.name === 'upload_file').length, 1);
  assert.equal(h.calls.filter(call => call.name === 'run_flow').length, 1);
});

test('unknown creation never creates another flow on rerun', async () => {
  const h = harness();
  const original = h.deps.client.call;
  h.deps.client.call = async (name, args) => { const result = await original(name, args); if (name === 'create_flow') throw Error('connection lost'); return result; };
  await assert.rejects(advanceCnapsAudition('prepare', h.deps));
  assert.equal(h.state().phase, 'create_intent');
  await assert.rejects(advanceCnapsAudition('prepare', h.deps), {code: 'uncertain_create_do_not_repeat'});
  assert.equal(h.calls.filter(call => call.name === 'create_flow').length, 1);
});

test('unknown generation is never resubmitted after a timeout or provider rejection', async () => {
  for (const problem of ['timeout', 'rejected']) {
    const h = harness();
    const original = h.deps.client.call;
    h.deps.client.call = async (name, args) => { const result = await original(name, args); if (name === 'run_flow') throw Error(problem); return result; };
    await assert.rejects(advanceCnapsAudition('run', h.deps));
    assert.equal(h.state().generation_attempted, true);
    assert.equal(h.state().phase, 'generation_unknown');
    await advanceCnapsAudition('run', h.deps);
    assert.equal(h.calls.filter(call => call.name === 'run_flow').length, 1);
  }
});

test('cannot send generation if persisting its intent fails', async () => {
  const h = harness(); const save = h.deps.save;
  h.deps.save = async state => { if (state.generation_attempted) throw Error('disk unavailable'); await save(state); };
  await assert.rejects(advanceCnapsAudition('run', h.deps));
  assert.equal(h.calls.some(call => call.name === 'run_flow'), false);
});

test('explicit quota refusal becomes a durable rejection and cannot start another generation', async () => {
  const h = harness(); const original = h.deps.client.call;
  h.deps.client.call = async (name, args) => {
    const result = await original(name, args);
    if (name === 'run_flow') throw new CnapsInspectionError('provider_quota_exceeded');
    return result;
  };
  await assert.rejects(advanceCnapsAudition('run', h.deps), {code: 'provider_quota_exceeded'});
  assert.equal(h.state().phase, 'quota_rejected');
  assert.equal(h.state().generation_attempted, true);
  await advanceCnapsAudition('run', h.deps);
  assert.equal(h.calls.filter(call => call.name === 'run_flow').length, 1);
  const refused = {isError: true, content: [{type: 'text',
    text: 'insufficient credits: your usage quota has been exceeded for the current billing period'}]};
  assert.equal(cnapsToolErrorCode(refused), 'provider_quota_exceeded');
  assert.equal(cnapsToolErrorCode({isError: true, content: [{type: 'text', text: key}]}), 'provider_tool_error');
  assert.equal(cnapsToolErrorCode({...refused, isError: false}), null);
});

test('plan, quota, account, model or trial mismatch blocks Free admission', () => {
  for (const mutate of [
    a => { a.account_plan_reported = 'pro'; }, a => { a.free_plan_reported = false; },
    a => { a.usage_observation.is_unlimited = true; }, a => { a.usage_observation.usage_percent = 100; },
    a => { a.usage_observation.usage_percent = NaN; }, a => { a.usage_observation.usage_percent = '0'; },
    a => { a.reference_model_observation.selection_sha256 = 'changed'; },
  ]) { const changed = structuredClone(account); mutate(changed); assert.throws(() => admitCnapsAudition(changed)); }
  assert.throws(() => admitCnapsAudition(account, 'b'.repeat(64)), {code: 'account_changed'});
});

test('fresh admission catches account changes after reference upload and preserves the existing flow', async () => {
  const h = harness(); let reads = 0;
  h.deps.inspect = async () => { reads++; return reads === 3 ? {...account, account_fingerprint: 'b'.repeat(64)} : account; };
  await assert.rejects(advanceCnapsAudition('run', h.deps), {code: 'account_changed'});
  assert.equal(h.calls.filter(call => call.name === 'create_flow').length, 1);
  assert.equal(h.calls.some(call => call.name === 'run_flow'), false);
  assert.equal(h.state().phase, 'reference_ready');
});

test('changed original image or remote bytes cannot reach generation', async () => {
  const h = harness({hashBytes: undefined});
  await assert.rejects(advanceCnapsAudition('run', h.deps), {code: 'approved_reference_changed'});
  assert.equal(h.calls.length, 0);
  const remote = harness({verifyRemoteReference: async () => { throw Error('remote changed'); }});
  await assert.rejects(advanceCnapsAudition('run', remote.deps));
  assert.equal(remote.state().phase, 'upload_intent');
  await assert.rejects(advanceCnapsAudition('run', remote.deps), {code: 'uncertain_upload_do_not_repeat'});
  assert.equal(remote.calls.filter(call => call.name === 'upload_file').length, 1);
  assert.equal(remote.calls.some(call => call.name === 'run_flow'), false);
});

test('graph changes cannot substitute an external model, frame count, resolution or reference connection', () => {
  validateAuditionDetail(flow, flow.flow_id);
  for (const mutate of [
    f => { f.nodes[2].model_id = 'llm-gemini-veo'; },
    f => { f.nodes[2].parameters.steps = 20; },
    f => { f.nodes[2].parameters.num_frames = '345'; },
    f => { f.nodes[2].parameters.resolution = 'square'; },
    f => { f.connections[1].in_port_index = 2; },
    f => { f.nodes.push({id: 2, type: 'ai_model', model_id: 'paid-model'}); },
  ]) { const changed = structuredClone(flow); mutate(changed); assert.throws(() => validateAuditionDetail(changed, flow.flow_id)); }
});

test('stored connection indices normalize only equivalent ports; public or already run flows remain blocked', () => {
  const stored = structuredClone(flow);
  stored.connections = stored.connections.map(({in_port_index, out_port_index, ...rest}) =>
    ({...rest, in_index: in_port_index, out_index: out_port_index}));
  validateAuditionDetail(stored, flow.flow_id);
  stored.connections[0].in_port_index = 1;
  assert.throws(() => validateAuditionDetail(stored, flow.flow_id));
  for (const mutate of [f => { f.permission = 'public'; }, f => { f.access_role = 'viewer'; },
    f => { f.status = 'running'; }, f => { f.nodes[2].status = 'completed'; }]) {
    const changed = structuredClone(flow); mutate(changed);
    assert.throws(() => validateAuditionDetail(changed, flow.flow_id));
  }
});

test('resume alone cannot create or upload; unknown local plans remain blocked', async () => {
  const h = harness();
  await assert.rejects(advanceCnapsAudition('resume', h.deps), {code: 'nothing_to_resume'});
  h.set({plan_sha256: 'changed'});
  await assert.rejects(advanceCnapsAudition('run', h.deps), {code: 'local_plan_changed'});
  h.set({plan_sha256: PLAN_SHA, flow_id: flow.flow_id, phase: 'created', generation_attempted: false});
  await advanceCnapsAudition('resume', h.deps);
  assert.deepEqual(h.calls.map(call => call.name), ['get_flow']);
});

test('upload URL arrays accept exactly one reference, never an arbitrary member of an ambiguous response', () => {
  const url = 'https://storage.googleapis.com/fixture/malu.png';
  assert.equal(uploadedReferenceUrl({urls: [url], filename: 'malu-approved.png'}), url);
  for (const value of [{}, {urls: []}, {urls: [url, url + 'other']}, {url, file_url: url + 'other'}]) {
    assert.throws(() => uploadedReferenceUrl(value), {code: 'ambiguous_uploaded_reference'});
  }
});

const key = 'fixture-only-not-a-real-credential';
function transport() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://mcp.cnaps.ai/mcp'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers['x-api-key'], key);
    const body = JSON.parse(init.body); calls.push(body);
    if (body.method === 'notifications/initialized') return new Response(null, {status: 202});
    const result = body.method === 'initialize' ? {protocolVersion: '2025-06-18', capabilities: {tools: {}}}
      : body.method === 'tools/list' ? {tools: ['run_flow', 'create_flow', 'get_flow', 'upload_file'].map(name => ({name,
        inputSchema: {type: 'object', properties: {flow_id: {type: 'string'}, run: {type: 'boolean'}}}}))}
        : {content: [{type: 'text', text: '{"state":"running"}'}]};
    return Response.json({jsonrpc: '2.0', id: body.id, result});
  }; return {calls, fetchImpl};
}
test('transport refuses writes by default, unknown tools and incompatible argument schemas', async () => {
  const t = transport(); const client = await connectCnapsAudition(key, t);
  await assert.rejects(client.call('run_flow', {flow_id: 'fixture'}), {code: 'forbidden_audition_tool'});
  const writable = await connectCnapsAudition(key, {...t, allowWrites: true});
  for (const name of ['run_batch', 'create_community_post', 'report_issue', 'delete_flow', 'subscribe']) {
    await assert.rejects(writable.call(name, {}), {code: 'forbidden_audition_tool'});
  }
  await assert.rejects(writable.call('run_flow', {flow_id: 123}), {code: 'unknown_tool_contract'});
  await assert.rejects(writable.call('create_flow', {run: 'true'}), {code: 'unknown_tool_contract'});
  assert.equal(t.calls.some(call => call.method === 'tools/call'), false);
});

test('media downloads never forward credentials, follow redirects or accept other origins', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push(String(url));
    assert.equal(new URL(url).origin, 'https://storage.googleapis.com');
    assert.equal(init.headers, undefined); assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error'); return new Response('fixture-media'); };
  assert.equal((await fetchCnapsMedia('https://storage.googleapis.com/fixture/image.png', 100, {fetchImpl})).toString(), 'fixture-media');
  for (const url of ['https://attacker.invalid/image.png', 'http://storage.googleapis.com/image.png',
    'https://user:password@storage.googleapis.com/image.png', 'https://storage.googleapis.com:8080/image.png']) {
    await assert.rejects(fetchCnapsMedia(url, 100, {fetchImpl}));
  }
  assert.equal(calls.length, 1);
  await assert.rejects(fetchCnapsMedia(calls[0], 4, {fetchImpl}), {code: 'media_too_large'});
  await assert.rejects(fetchCnapsMedia(calls[0], 100, {fetchImpl: async () => new Response('redirect', {status: 302})}), {code: 'media_fetch_failed'});
  await assert.rejects(fetchCnapsMedia(calls[0], 100, {fetchImpl: async () => { throw Error(key); }}), {message: 'media_fetch_failed'});
});
