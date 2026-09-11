import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const required = ['supabase/verify-migrations.sql','supabase/seed.sql','.github/workflows/render.yml','.github/workflows/assets.yml'];
if (process.argv.includes('--production')) {
  for (const fn of ['telegram-bot','publish-youtube','collect-analytics','heartbeat']) required.push(`supabase/functions/${fn}/index.ts`);
}
const missing = required.filter(file=>!existsSync(file));
if (missing.length) { console.error(`Bloqueios de implementação: ${missing.join(', ')}`); process.exit(1); }
const npm = process.platform==='win32' ? 'npm.cmd' : 'npm';
// Avoid invoking a shell with task/user input.
for (const task of ['typecheck','test']) {
  execFileSync(npm,['run',task],{stdio:'inherit',shell:process.platform==='win32'});
}
console.log('Código local verificado. Cloud, quotas, OAuth e publicação exigem validação real.');
