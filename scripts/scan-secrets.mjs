import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  /AIza[\w-]{35}/,
  /(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{30,}/,
  /sk-(?:or-v1-)?[A-Za-z0-9]{32,}/,
  /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,50}\b/,
];
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
let findings = 0;
for (const file of new Set(files)) {
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) {
    console.error(`Arquivo de ambiente versionado: ${file}`); findings++; continue;
  }
  let body;
  try { body = readFileSync(file, 'utf8'); } catch { continue; }
  if (patterns.some(pattern => pattern.test(body))) { console.error(`Possível segredo em ${file} (valor omitido)`); findings++; }
}
if (process.argv.includes('--history')) {
  const revisions = execFileSync('git', ['rev-list', '--all'], {encoding:'utf8'}).trim().split('\n');
  for (const revision of revisions) {
    const diff = execFileSync('git', ['show', '--format=', revision], {encoding:'utf8',maxBuffer:20*1024*1024});
    if (patterns.some(pattern=>pattern.test(diff))) { console.error(`Possível segredo no commit ${revision} (valor omitido)`); findings++; }
  }
}
if (findings) process.exitCode=1;
else console.log('Scan de padrões de segredos: nenhum achado. Não substitui proteção do provedor.');
