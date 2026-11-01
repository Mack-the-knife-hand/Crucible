// Security check of the third-party code that actually ships inside Crucible.
//
//   npm run audit:shipped
//
// Why not just "npm audit --omit=dev"? Crucible bundles its libraries itself:
// marked and DOMPurify are copied into src/vendor/, and Electron is the
// program's runtime. All three are listed as devDependencies (so the
// installer doesn't ship node_modules twice), which means --omit=dev skips
// exactly the code that matters. This script:
//   1. runs a full `npm audit` and reports any advisory affecting a shipped
//      component (build-only tools are listed separately, for information);
//   2. checks the copies in src/vendor/ are byte-identical to the audited
//      package versions in node_modules (so the audit applies to them);
//   3. checks Electron is on the newest patch release of its major version
//      (Electron patches carry Chromium security fixes).
// Exit codes: 0 = everything was checked and is fine; 1 = something shipped
// needs attention; 2 = a check couldn't be completed (offline, registry
// error, unexpected output). "Couldn't check" is never reported as clean.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SHIPPED = {
  electron: { how: 'program runtime (Chromium + Node.js)' },
  marked: { how: 'copied to src/vendor/marked.umd.js', vendor: 'src/vendor/marked.umd.js', from: 'node_modules/marked/lib/marked.umd.js' },
  dompurify: { how: 'copied to src/vendor/purify.min.js', vendor: 'src/vendor/purify.min.js', from: 'node_modules/dompurify/dist/purify.min.js' },
};
let problems = 0;
const unverified = []; // checks that could not be completed
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const version = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;

// 1. Full audit. npm exits non-zero both when it finds advisories (normal)
// and when it fails (offline, registry error), so the output itself is
// checked: only a complete version-2 audit report counts as an answer.
let audit = null, auditErr = '';
try {
  audit = JSON.parse(execSync('npm audit --json', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
} catch (e) {
  try { audit = JSON.parse(String(e.stdout || '')); } catch { audit = null; }
  auditErr = String(e.stderr || '').split('\n').find((l) => l.trim()) || e.message;
}
const complete = !!audit && audit.auditReportVersion === 2 && !audit.error
  && audit.vulnerabilities && typeof audit.vulnerabilities === 'object'
  && audit.metadata && audit.metadata.vulnerabilities && audit.metadata.dependencies
  && Number(audit.metadata.dependencies.total) > 0;
console.log('Shipped components:');
if (!complete) {
  const why = (audit?.error ? `${audit.error.code || ''} ${audit.error.summary || ''}`.trim() : auditErr) || 'no usable answer from the npm registry';
  unverified.push(`npm audit did not return a complete report (${why})`);
  for (const [name, info] of Object.entries(SHIPPED)) console.log(`  ? ${name} ${version(name)}: ${info.how}: NOT CHECKED`);
} else {
  const vulns = audit.vulnerabilities;
  for (const [name, info] of Object.entries(SHIPPED)) {
    const v = vulns[name];
    const titles = v ? v.via.map((x) => (typeof x === 'object' ? `${x.title} (${x.severity})` : `via ${x}`)) : [];
    console.log(`  ${v ? '✗' : '✓'} ${name} ${version(name)}: ${info.how}${v ? `\n      ${titles.join('\n      ')}` : ': no known advisories'}`);
    if (v) problems++;
  }
  const buildOnly = Object.keys(vulns).filter((n) => !SHIPPED[n]);
  console.log(`\nBuild-only tools (not inside Crucible): ${buildOnly.length ? `${buildOnly.length} with advisories: ${buildOnly.join(', ')}` : 'no advisories'}`);
}

// 2. Vendored copies match the audited versions
console.log('\nVendored copies:');
for (const [name, info] of Object.entries(SHIPPED)) {
  if (!info.vendor) continue;
  const same = sha(info.vendor) === sha(info.from);
  console.log(`  ${same ? '✓' : '✗'} ${info.vendor} ${same ? `is identical to ${name} ${version(name)}` : `DIFFERS from node_modules (run npm run vendor)`}`);
  if (!same) problems++;
}

// 3. Newest Electron patch
try {
  const cur = version('electron');
  const major = cur.split('.')[0];
  const latest = execSync(`npm view electron@${major} version --json`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const list = [].concat(JSON.parse(latest)).filter((x) => typeof x === 'string' && /^\d+\.\d+\.\d+$/.test(x));
  if (!list.length) throw new Error('no release list');
  const newest = list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  const ok = newest === cur;
  console.log(`\nElectron: ${ok ? '✓' : '✗'} ${cur}${ok ? ' is the newest ' + major + '.x release' : ` → ${newest} is available (update: npm install electron@${newest})`}`);
  if (!ok) problems++;
} catch (e) {
  console.log('\nElectron: ? could not check for newer releases: NOT CHECKED');
  unverified.push(`Electron release check failed (${e.message.split('\n')[0]})`);
}

if (problems) {
  console.log(`\n${problems} item(s) need attention.${unverified.length ? `\nAlso NOT verified:\n  - ${unverified.join('\n  - ')}` : ''}`);
  process.exit(1);
}
if (unverified.length) {
  console.log(`\nNOT VERIFIED: ${unverified.length} check(s) could not be completed, so this is not a clean result:\n  - ${unverified.join('\n  - ')}\nCheck your network / npm registry and run it again.`);
  process.exit(2);
}
console.log('\nAll shipped components check out.');
process.exit(0);
