/** Operator discovery. Key stays in env; fixed read-only MCP tools, no inference. */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {inspectCnaps, CnapsInspectionError} from './lib/cnaps-inspection.mjs';

const root = resolve(import.meta.dirname, '..');
try {
  if (process.argv.length !== 2) throw new CnapsInspectionError('no_arguments_supported_use_env_file');
  let fromFile;
  try {
    const body = await readFile(join(root, '.env.cloud'), 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?CNAPS_API_KEY\s*=\s*(.*?)\s*$/);
      if (match) fromFile = match[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new CnapsInspectionError('credential_file_unavailable');
  }
  const report = await inspectCnaps(process.env.CNAPS_API_KEY ?? fromFile);
  const directory = join(root, 'output/cnaps-discovery');
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'inspection.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  process.stdout.write(JSON.stringify({status: 'inspection_complete', production_ready: false,
    generation_submitted: false, estimated_video_seconds: null,
    plan_reported: report.account_plan_reported,
    usage_percent: report.usage_observation?.usage_percent ?? null,
    reset_period_hours: report.usage_observation?.reset_period_hours ?? null,
    reference_model_contract_observed: report.reference_model_observation !== null,
    report: 'output/cnaps-discovery/inspection.json'}) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({status: 'blocked', production_ready: false,
    generation_submitted: false,
    code: error instanceof CnapsInspectionError ? error.code : 'inspection_failed'}) + '\n');
  process.exitCode = 1;
}
