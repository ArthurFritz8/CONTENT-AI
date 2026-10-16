/** One fixed, free-plan audition. Durable intents precede every provider mutation. */
import {createHash} from 'node:crypto';
import {CnapsInspectionError} from './cnaps-inspection.mjs';
export const MODEL = 'Txt2Video-MiniMax-H3-Ref2VA';
export const REFERENCE = 'output/suitcase-story-preview/references/malu-entryway-v1.png';
export const REFERENCE_SHA = 'd7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c';
export const SELECTION_SHA = '619449613b1bcdf7ee22d32f6eb277711473909ef94af2c50454fa79df3d989e';
export const PARAMETERS = Object.freeze({num_frames: '124 frames (~5.2s @ 24fps)', resolution: '768x1344 (9:16)', steps: 30, seed: 42016});
export const PROMPT = 'A single continuous 5.17-second cinematic 3D animated Brazilian soap-opera shot. '
  + 'Animate the exact adult apple woman in the reference image tagged <Picture 1>. Preserve her apple-shaped '
  + 'red textured face, sharp brown eyes, voluminous brown curly hair, gold hoop earrings and cream floral dress, '
  + 'the same proportions and warm golden entryway lighting. She looks toward her partner just off camera on her right. '
  + 'She takes a short breath, shifts her shoulders and weight slightly forward, raises her right hand naturally to her '
  + 'chest for one restrained questioning gesture, then lowers it. Her hand has five stable fingers. Her eyebrows '
  + 'and eyes convey hurt and disbelief. Keep the camera steady, waist-up framing and continuous natural body movement. '
  + 'She speaks on screen in Brazilian Portuguese, with an expressive adult female voice and synchronized visible '
  + 'mouth movement, saying exactly: "Você ia embora sem me contar?" One speaker, one short sentence. No voice-over, '
  + 'no additional speech, no music, no subtitles, no text, no cuts. End with a brief silent emotional reaction.';
export const NODES = Object.freeze([{id: 1000, type: 'input', model_id: 'Text-Input'},
  {id: 1001, type: 'input', model_id: 'Image-Loader'},
  {id: 1, type: 'ai_model', model_id: MODEL, parameters: PARAMETERS},
  {id: 1003, type: 'output', model_id: 'Video-Viewer'}].map(Object.freeze));
export const CONNECTIONS = Object.freeze([
  {out_node_id: 1000, out_port_index: 0, in_node_id: 1, in_port_index: 0},
  {out_node_id: 1001, out_port_index: 0, in_node_id: 1, in_port_index: 1},
  {out_node_id: 1, out_port_index: 0, in_node_id: 1003, in_port_index: 0},
].map(Object.freeze));
export const PLAN_SHA = createHash('sha256').update(JSON.stringify({MODEL, REFERENCE_SHA, PROMPT, NODES, CONNECTIONS})).digest('hex');
const fail = code => { throw new CnapsInspectionError(code); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function uploadedReferenceUrl(result) {
  const candidates = [result?.file_url, result?.url, ...(Array.isArray(result?.urls) ? result.urls : [])]
    .filter(value => typeof value === 'string');
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) fail('ambiguous_uploaded_reference');
  return unique[0];
}

export function admitCnapsAudition(report, accountFingerprint) {
  if (report?.provider !== 'cnaps' || report.free_plan_reported !== true ||
      report.account_plan_verified !== true || report.account_plan_reported !== 'free' ||
      !/^[a-f0-9]{64}$/.test(report.account_fingerprint ?? '') ||
      report.usage_observation?.is_unlimited !== false ||
      typeof report.usage_observation?.usage_percent !== 'number' ||
      !Number.isFinite(report.usage_observation.usage_percent) ||
      report.usage_observation.usage_percent < 0 || report.usage_observation.usage_percent >= 100 ||
      report.reference_model_observation?.selection_sha256 !== SELECTION_SHA) fail('free_audition_not_admitted');
  if (accountFingerprint && report.account_fingerprint !== accountFingerprint) fail('account_changed');
}

export function validateAuditionDetail(flow, flowId) {
  if (!flow || (flow.flow_id ?? flow.id) !== flowId || !Array.isArray(flow.nodes) ||
      flow.nodes.length !== 4 || !Array.isArray(flow.connections) || flow.connections.length !== 3) {
    fail('flow_contract_changed');
  }
  if (flow.permission !== 'private' || flow.access_role !== 'owner' || flow.state !== 'activated' ||
      (flow.status !== undefined && flow.status !== '')) fail('private_unused_flow_unverified');
  for (const expected of NODES) {
    const node = flow.nodes.find(value => value.id === expected.id);
    if (!node || node.type !== expected.type || node.model_id !== expected.model_id) fail('flow_contract_changed');
    if (node.parameters?.model_id !== undefined && node.parameters.model_id !== expected.model_id) fail('flow_contract_changed');
    if (node.status !== undefined && node.status !== 'pending') fail('flow_already_executed');
    if (node.id === 1) {
      for (const [name, value] of Object.entries(PARAMETERS)) if (node.parameters?.[name] !== value) fail('flow_contract_changed');
    }
  }
  for (const expected of CONNECTIONS) if (!flow.connections.some(connection => {
    const normalized = {...connection,
      in_port_index: connection.in_port_index ?? connection.in_index,
      out_port_index: connection.out_port_index ?? connection.out_index};
    if ((connection.in_port_index !== undefined && connection.in_index !== undefined &&
        connection.in_port_index !== connection.in_index) ||
        (connection.out_port_index !== undefined && connection.out_index !== undefined &&
        connection.out_port_index !== connection.out_index)) return false;
    return Object.entries(expected).every(([field, value]) => normalized[field] === value);
  })) fail('flow_contract_changed');
}

/** Dependencies are supplied by the operator CLI, which holds a process lock. resume never mutates. */
export async function advanceCnapsAudition(mode, {load, save, inspect, client, referenceBytes,
  transferReference, verifyRemoteReference, now = () => new Date(),
  hashBytes = bytes => createHash('sha256').update(bytes).digest('hex')} ) {
  if (!['prepare', 'run', 'resume'].includes(mode)) fail('unknown_mode');
  const bytes = await referenceBytes();
  if (hashBytes(bytes) !== REFERENCE_SHA) fail('approved_reference_changed');
  let state = await load();
  if (state && state.plan_sha256 !== PLAN_SHA) fail('local_plan_changed');
  const persist = async values => { state = {...state, ...values, updated_at: now().toISOString()}; await save(state); };
  if (!state) {
    if (mode === 'resume') fail('nothing_to_resume');
    const account = await inspect(); admitCnapsAudition(account);
    const preview = await client.call('preview_flow', {nodes: JSON.stringify(NODES),
      connections: JSON.stringify(CONNECTIONS), include_optional: false});
    if (preview.compatible !== true) fail('incompatible_flow');
    await persist({version: 1, plan_sha256: PLAN_SHA, phase: 'create_intent',
      account_fingerprint: account.account_fingerprint, usage_before: account.usage_observation,
      maximum_cash_spend_usd: 0, generation_attempted: false,
      flow_name: `content-ai-malu-cnaps-${PLAN_SHA.slice(0, 12)}`, started_at: now().toISOString()});
    const created = await client.call('create_flow', {name: state.flow_name, nodes: JSON.stringify(NODES),
      connections: JSON.stringify(CONNECTIONS), include_optional: false, run: false});
    const flowId = created.flow_id ?? created.id;
    if (!id(flowId)) fail('unknown_create_result_do_not_repeat');
    await persist({phase: 'created', flow_id: flowId});
  }
  if (!id(state.flow_id)) fail('uncertain_create_do_not_repeat');
  if (state.phase === 'collected') return state;
  // Once a generation has an intent, every subsequent invocation is read-only.
  if (state.generation_attempted || mode === 'resume') {
    const status = await client.call('get_flow', {flow_id: state.flow_id, view: 'status'});
    await persist({provider_status: status});
    return state;
  }
  const flow = await client.call('get_flow', {flow_id: state.flow_id, view: 'detail'});
  validateAuditionDetail(flow, state.flow_id);
  if (mode === 'prepare') return state;
  if (!state.remote_reference_url) {
    if (state.phase === 'upload_intent') fail('uncertain_upload_do_not_repeat');
    const account = await inspect(); admitCnapsAudition(account, state.account_fingerprint);
    await persist({phase: 'upload_intent'});
    const signedUrl = await transferReference(bytes);
    const uploaded = await client.call('upload_file', {file_url: signedUrl, filename: 'malu-approved.png'});
    await persist({uploaded_reference_response: uploaded});
    const remote = uploadedReferenceUrl(uploaded);
    // Verification fetch carries no provider token and must hash to the approved PNG.
    await verifyRemoteReference(remote, REFERENCE_SHA);
    await persist({phase: 'reference_ready', remote_reference_url: remote});
  }
  const account = await inspect(); admitCnapsAudition(account, state.account_fingerprint);
  validateAuditionDetail(await client.call('get_flow', {flow_id: state.flow_id, view: 'detail'}), state.flow_id);
  // This bit is never cleared, even if the POST times out, returns an error, or saving its result fails.
  await persist({phase: 'generation_unknown', generation_attempted: true,
    generation_intent_at: now().toISOString(), usage_before_run: account.usage_observation});
  try {
    const result = await client.call('run_flow', {flow_id: state.flow_id,
      inputs: JSON.stringify({'1000': [PROMPT], '1001': [state.remote_reference_url]})});
    await persist({phase: 'submitted', submission_response: result});
  } catch (error) {
    if (error instanceof CnapsInspectionError && error.code === 'provider_quota_exceeded') {
      await persist({phase: 'quota_rejected', provider_rejection_code: 'provider_quota_exceeded'});
    }
    throw error;
  }
  return state;
}
