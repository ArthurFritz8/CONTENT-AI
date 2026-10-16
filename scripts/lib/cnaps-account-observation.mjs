/** Maps the authenticated read contract observed on 2026-10-16. Never quotes video capacity. */
import {createHash} from 'node:crypto';

export const CNAPS_REFERENCE_MODEL = 'Txt2Video-MiniMax-H3-Ref2VA';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const plans = new Set(['free', 'starter', 'pro', 'business', 'enterprise']);
const plan = value => plans.has(value) ? value : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function observeCnapsAccount(workspace, usage) {
  const workspaceValid = record(workspace) && typeof workspace.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(workspace.id) &&
    ['personal', 'business'].includes(workspace.type) && typeof workspace.status === 'string';
  const usageValid = record(usage) && amount(usage.usage_percent) && usage.usage_percent <= 100 &&
    typeof usage.is_unlimited === 'boolean' && Number.isInteger(usage.reset_period_hours) &&
    usage.reset_period_hours > 0 && usage.reset_period_hours <= 744;
  const workspacePlan = workspaceValid ? plan(workspace.plan_name) : null;
  const usagePlan = usageValid ? plan(usage.plan) : null;
  const matches = workspacePlan !== null && workspacePlan === usagePlan && workspace.status === 'active';
  return {
    account_fingerprint: workspaceValid
      ? createHash('sha256').update(`cnaps:${workspace.id}`).digest('hex') : null,
    account_plan_verified: matches,
    account_plan_reported: matches ? workspacePlan : null,
    free_plan_reported: matches && workspacePlan === 'free' && usage.is_unlimited === false,
    trial_status: 'not_reported',
    usage_observation: usageValid ? {
      usage_percent: usage.usage_percent, is_unlimited: usage.is_unlimited,
      reset_period_hours: usage.reset_period_hours,
      absolute_gpu_allowance_seconds: null, reset_at: null,
    } : null,
  };
}

export function findCnapsReferenceModel(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 100) return null;
  const matches = [];
  for (const group of catalog) {
    if (!record(group) || !Array.isArray(group.models) || group.models.length > 500) return null;
    for (const model of group.models) {
      if (record(model) && model.id === CNAPS_REFERENCE_MODEL) matches.push(model);
    }
  }
  if (matches.length !== 1) return null;
  const model = matches[0];
  if (model.accessible !== true || model.min_required_plan !== 'free' || model.type !== 'ai_model' ||
      !Array.isArray(model.input_types) || !['image', 'string'].every(type => model.input_types.includes(type)) ||
      !Array.isArray(model.output_types) || !model.output_types.includes('video')) return null;
  return CNAPS_REFERENCE_MODEL;
}

export function observeCnapsReferenceParameters(detail, schema) {
  if (!record(detail) || detail.id !== CNAPS_REFERENCE_MODEL || detail.accessible !== true ||
      detail.min_required_plan !== 'free' || !record(schema) || schema.model_id !== CNAPS_REFERENCE_MODEL ||
      !Array.isArray(schema.parameters) || schema.parameters.length !== 4) return null;
  const params = new Map(schema.parameters.filter(record).map(parameter => [parameter.name, parameter]));
  if (params.size !== 4) return null;
  const frames = params.get('num_frames'), canvas = params.get('resolution');
  const steps = params.get('steps'), seed = params.get('seed');
  const frameLabel = '124 frames (~5.2s @ 24fps)', canvasLabel = '768x1344 (9:16)';
  const dropdown = (parameter, label, value) => record(parameter) && parameter.type === 'string' &&
    Array.isArray(parameter.values) && parameter.values.includes(label) &&
    record(parameter.values_map) && parameter.values_map[label] === value;
  if (!dropdown(frames, frameLabel, '124') || !dropdown(canvas, canvasLabel, '768x1344') ||
      steps?.type !== 'integer' || steps.default_value !== 30 ||
      JSON.stringify(steps.range) !== '[20,75]' || seed?.type !== 'integer' ||
      JSON.stringify(seed.range) !== '[-1,2147483647]') return null;
  if (!Array.isArray(detail.inputs) || !Array.isArray(detail.outputs)) return null;
  const image = detail.inputs.find(input => record(input) && input.type === 'image');
  const text = detail.inputs.find(input => record(input) && input.type === 'string');
  if (image?.key_name !== 'input_optional_image_file' || text?.key_name !== 'input_text_file' ||
      !detail.outputs.some(output => output?.type === 'video')) return null;
  const selected = {num_frames: frameLabel, resolution: canvasLabel, steps: 30, seed: 42016};
  return {model_id: CNAPS_REFERENCE_MODEL, accessible_reported: true,
    minimum_plan_reported: 'free', selected_parameters: selected,
    expected_media_from_documentation: {frames: 124, fps: 24, width: 768, height: 1344,
      seconds: 124 / 24, native_audio: true},
    // This fingerprints the proposed selection, not arbitrary provider descriptions/defaults.
    selection_sha256: createHash('sha256').update(JSON.stringify({model: CNAPS_REFERENCE_MODEL,
      parameters: selected})).digest('hex'),
    generation_access_verified: false, quality_verified: false};
}
