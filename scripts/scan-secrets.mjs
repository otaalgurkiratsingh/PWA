// Scan tracked files, git history, and the production bundle for credentials.
// Usage: npm run scan:secrets   (run `npm run build` first to include dist/)
// Exits non-zero on any finding. Prints only file + rule, never the matched value.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  ['supabase-secret-key', /sb_secret_[0-9A-Za-z_-]{20,}/],
  ['jwt-service-role', /eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]*c2VydmljZV9yb2xl[0-9A-Za-z_-]*\./], // base64 of "service_role"
  ['private-key-block', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['frontend-gemini-var', /VITE_GEMINI/],
  ['frontend-secret-var', /VITE_[A-Z_]*(SECRET|SERVICE_ROLE)[A-Z_]*/],
  ['generic-assignment', /(GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*=\s*['"]?[A-Za-z0-9_-]{16,}/],
];
// Files that legitimately NAME these patterns (docs, this scanner, the spec) — still scanned for real values.
const NAME_ONLY_OK = new Set(['frontend-gemini-var', 'frontend-secret-var']);
const DOC_FILES = /^(docs\/|scripts\/scan-secrets\.mjs$|README\.md$|\.env\.example$)/;

const findings = [];
const check = (label, text, isDoc) => {
  for (const [rule, re] of RULES) {
    if (isDoc && NAME_ONLY_OK.has(rule)) continue;
    if (re.test(text)) findings.push(`${label}: ${rule}`);
  }
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// 1. Tracked + staged files.
const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
for (const f of files) {
  if (!existsSync(f) || statSync(f).size > 5_000_000 || /\.(png|jpg|ico)$/.test(f)) continue;
  check(f, readFileSync(f, 'utf8'), DOC_FILES.test(f));
}

// 2. Env files must never be tracked.
for (const f of files) if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')) findings.push(`${f}: tracked-env-file`);

// 3. Full git history (added lines only).
try {
  const history = git('log', '-p', '--all', '--no-color', '--unified=0');
  let current = '';
  for (const line of history.split('\n')) {
    if (line.startsWith('+++ b/')) current = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) check(`history:${current}`, line, DOC_FILES.test(current));
  }
} catch {
  // no commits yet
}

// 4. Production bundle: no secrets, no source maps.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
if (existsSync('dist')) {
  for (const f of walk('dist')) {
    if (f.endsWith('.map')) findings.push(`${f}: source-map-in-bundle`);
    if (/\.(js|html|css|webmanifest)$/.test(f)) {
      const text = readFileSync(f, 'utf8');
      check(f, text, false);
      if (/sourceMappingURL/.test(text)) findings.push(`${f}: sourceMappingURL`);
    }
  }
} else {
  console.warn('dist/ not found — run `npm run build` to scan the bundle too.');
}

const unique = [...new Set(findings)];
if (unique.length) {
  console.error(`Secret scan FAILED (${unique.length}):\n  ${unique.join('\n  ')}`);
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files, git history, ${existsSync('dist') ? 'dist bundle' : 'no bundle'}.`);
