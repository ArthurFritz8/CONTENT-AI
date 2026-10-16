/** Operator only, one authorized Free audition. No Studio/episode/publication mutations. */
import {readFile, writeFile, mkdir, rename, open, unlink, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectCnaps, CnapsInspectionError} from './lib/cnaps-inspection.mjs';
import {connectCnapsAudition, cnapsMediaUrl, fetchCnapsMedia} from './lib/cnaps-audition-client.mjs';
import {advanceCnapsAudition, PLAN_SHA, REFERENCE} from './lib/cnaps-malu-audition.mjs';

const root = resolve(import.meta.dirname, '..'), directory = join(root, 'output/cnaps-malu-audition');
const checkpoint = join(directory, 'checkpoint.json'), lock = join(directory, '.operation.lock');
const attempted = join(directory, '.generation-attempted');
const fail = code => { throw new CnapsInspectionError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const load = async () => await exists(checkpoint) ? JSON.parse(await readFile(checkpoint, 'utf8')) : null;
async function save(state) {
  if (state.generation_attempted && !await exists(attempted)) {
    const handle = await open(attempted, 'wx', 0o600);
    try { await handle.writeFile(PLAN_SHA); await handle.sync(); } finally { await handle.close(); }
  }
  const temporary = checkpoint + '.writing';
  const handle = await open(temporary, 'w', 0o600);
  try { await handle.writeFile(JSON.stringify(state, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, checkpoint);
}
async function bounded(response, maximum) {
  if (!response.ok) { await response.body?.cancel(); fail('media_fetch_failed'); }
  const reader = response.body?.getReader(); if (!reader) fail('media_body_missing');
  const parts = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength; if (length > maximum) fail('media_too_large'); parts.push(value);
    }
  } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  return Buffer.concat(parts);
}
function summary(state) {
  return {phase: state?.phase ?? 'not_prepared', generation_attempted: state?.generation_attempted ?? false,
    production_ready: false, provider_state: state?.provider_status?.state ?? state?.provider_status?.status ?? null,
    provider_rejection_code: state?.provider_rejection_code ?? null,
    output_sha256: state?.output_sha256 ?? null, output: state?.output_sha256 ? 'output/cnaps-malu-audition/original.mp4' : null};
}
let handle;
try {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['prepare', 'run', 'resume', 'status', 'collect'].includes(mode)) fail('use_prepare_run_resume_status_or_collect');
  await mkdir(directory, {recursive: true});
  if (mode === 'status') { process.stdout.write(JSON.stringify(summary(await load())) + '\n'); }
  else {
    try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); }
    catch (error) { if (error.code === 'EEXIST') fail('operator_process_lock_exists'); throw error; }
    const initial = await load();
    if (await exists(attempted) && !initial?.generation_attempted) fail('uncertain_generation_state_do_not_repeat');
    const env = {};
    for (const line of (await readFile(join(root, '.env.cloud'), 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    const key = process.env.CNAPS_API_KEY ?? env.CNAPS_API_KEY;
    let auditSequence = 0;
    const client = await connectCnapsAudition(key, {allowWrites: ['prepare', 'run'].includes(mode),
      audit: async (tool, result) => {
        const privateDirectory = join(directory, 'private-responses');
        await mkdir(privateDirectory, {recursive: true});
        await writeFile(join(privateDirectory, `${Date.now()}-${++auditSequence}-${tool}.json`),
          JSON.stringify(result, null, 2), {mode: 0o600, flag: 'wx'});
      }});
    const inspect = async () => {
      const report = await inspectCnaps(key);
      await writeFile(join(directory, 'latest-account-observation.json'), JSON.stringify(report, null, 2), {mode: 0o600});
      return report;
    };
    const transferReference = async bytes => {
      let origin; try { origin = new URL(env.SUPABASE_URL); } catch { fail('studio_storage_unavailable'); }
      const service = env.CONTENT_AI_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
      if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co') || !service) fail('studio_storage_unavailable');
      const object = `00000000-0000-4000-8000-000000000001/auditions/cnaps/${PLAN_SHA}/malu-approved.png`;
      const objectPath = `/storage/v1/object/studio-private/${object}`;
      const signingPath = `/storage/v1/object/sign/studio-private/${object}`;
      const storageRequest = (path, method = 'GET', body, mime = 'application/json') => {
        if (![objectPath, signingPath, '/storage/v1/bucket/studio-private'].includes(path)) fail('untrusted_storage_path');
        return fetch(origin.origin + path, {method, body,
          headers: {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': mime, 'x-upsert': 'false'},
          redirect: 'error', signal: AbortSignal.timeout(35_000)});
      };
      const bucket = JSON.parse((await bounded(await storageRequest('/storage/v1/bucket/studio-private'), 64 * 1024)).toString());
      if (bucket.public !== false) fail('private_bucket_unverified');
      const uploaded = await storageRequest(objectPath, 'POST', bytes, 'image/png');
      // Existing deterministic objects are verified; no overwrite or second POST.
      await uploaded.body?.cancel();
      const verified = await bounded(await storageRequest(objectPath), 5 * 1024 * 1024);
      if (sha(verified) !== sha(bytes)) fail('private_reference_changed');
      const signed = JSON.parse((await bounded(await storageRequest(signingPath, 'POST', JSON.stringify({expiresIn: 3600})), 64 * 1024)).toString());
      if (typeof signed.signedURL !== 'string' || !signed.signedURL.startsWith(`/object/sign/studio-private/${object}?`)) fail('private_signing_failed');
      const signedUrl = new URL('/storage/v1' + signed.signedURL, origin.origin);
      if (signedUrl.origin !== origin.origin) fail('private_signing_failed');
      return signedUrl.href;
    };
    let state = await advanceCnapsAudition(['collect', 'resume'].includes(mode) ? 'resume' : mode,
      {load, save, inspect, client, referenceBytes: () => readFile(join(root, REFERENCE)), transferReference,
        verifyRemoteReference: async (url, expected) => {
          if (sha(await fetchCnapsMedia(url, 5 * 1024 * 1024)) !== expected) fail('remote_reference_changed');
        }});
    if (mode === 'collect' && state.phase !== 'collected') {
      const status = state.provider_status;
      // Deliberately narrow until the real provider's status shape is observed.
      if (!['completed', 'complete'].includes(status?.state ?? status?.status)) fail('generation_not_completed');
      const urls = new Set();
      const walk = (value, depth = 0) => {
        if (depth > 10) return;
        if (typeof value === 'string') {
          try { const parsed = cnapsMediaUrl(value); if (parsed.pathname.endsWith('.mp4')) urls.add(value); } catch {}
        } else if (Array.isArray(value)) value.slice(0, 50).forEach(item => walk(item, depth + 1));
        else if (value && typeof value === 'object') Object.values(value).slice(0, 50).forEach(item => walk(item, depth + 1));
      };
      walk(status);
      if (urls.size !== 1) fail('output_media_ambiguous');
      const bytes = await fetchCnapsMedia([...urls][0], 64 * 1024 * 1024);
      if (bytes.subarray(4, 8).toString() !== 'ftyp') fail('output_not_mp4');
      const output = join(directory, 'original.mp4');
      if (await exists(output)) { if (sha(await readFile(output)) !== sha(bytes)) fail('original_already_differs'); }
      else await writeFile(output, bytes, {flag: 'wx'});
      const after = await inspect();
      state = {...state, phase: 'collected', output_sha256: sha(bytes), output_bytes: bytes.length,
        usage_after: after.usage_observation, collected_at: new Date().toISOString()};
      await save(state);
    }
    process.stdout.write(JSON.stringify(summary(state)) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({status: 'blocked', production_ready: false,
    code: error instanceof CnapsInspectionError ? error.code : 'audition_failed'}) + '\n');
  process.exitCode = 1;
} finally {
  if (handle) { await handle.close(); await unlink(lock); }
}
