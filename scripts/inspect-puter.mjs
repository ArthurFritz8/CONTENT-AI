/** Operator discovery. Reads an ignored credential file; never submits a video. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inspectPuter, PuterInspectionError } from './lib/puter-inspection.mjs';

const root = resolve(import.meta.dirname, '..');
try {
  if (process.argv.length !== 2) throw new PuterInspectionError('no_arguments_supported_use_env_file');
  let fromFile;
  try {
    const body = await readFile(join(root, '.env.cloud'), 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?PUTER_AUTH_TOKEN\s*=\s*(.*?)\s*$/);
      if (match) fromFile = match[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new PuterInspectionError('credential_file_unavailable');
  }
  const report = await inspectPuter(process.env.PUTER_AUTH_TOKEN ?? fromFile);
  const directory = join(root, 'output/puter-discovery');
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'inspection.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  process.stdout.write(JSON.stringify({
    status: 'inspection_complete', production_ready: false,
    monthly_allowance_reported: report.wallet.monthly_allowance_reported,
    remaining_combined_reported: report.wallet.remaining_combined_reported,
    unit: report.wallet.unit,
    video_cost_lines: report.video_cost_observations.length,
    estimated_video_seconds: null,
    report: 'output/puter-discovery/inspection.json',
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({status: 'blocked', production_ready: false,
    code: error instanceof PuterInspectionError ? error.code : 'inspection_failed'}) + '\n');
  process.exitCode = 1;
}
