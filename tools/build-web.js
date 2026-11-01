// Builds the browser version: one self-contained HTML file with every
// script and style inlined.   node tools/build-web.js  ->  dist-web/crucible.html
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'dist-web');
const pkg = require('../package.json');

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// Browser security policy: scripts/styles only from this file; network only for AI calls.
const csp = [
  "default-src 'none'",
  "script-src __SCRIPT_HASHES__",
  "style-src 'unsafe-inline'",
  'img-src blob: data:',
  'media-src blob:',
  'font-src data:',
  'connect-src https: http:',
  "frame-src 'self' about: blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

// The app icon (tab icon, top bar) goes in as data: so the single file needs nothing else.
html = html.replace(/(src|href)="(img\/[^"]+\.png)"/g, (_m, a, f) =>
  `${a}="data:image/png;base64,${fs.readFileSync(path.join(SRC, f)).toString('base64')}"`);
// Larger copy for the welcome screen and About (read by App.logo(); it sits
// first in <body> so it's there before any script runs).
html = html.replace('<body>', () => `<body>\n<template id="appLogo">data:image/png;base64,${fs.readFileSync(path.join(SRC, 'img/icon-128.png')).toString('base64')}</template>`);

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_m, f) =>
  `<style>\n${fs.readFileSync(path.join(SRC, f), 'utf8')}\n</style>`);

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_m, f) => {
  const js = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>/* ${f} */\n${js}\n</script>`;
});

html = html.replace('<script>/* js/settings-core.js */', () => `<script>window.CRUCIBLE_VERSION = ${JSON.stringify(pkg.version)};</script>\n<script>/* js/settings-core.js */`);
html = html.replace('<title>Crucible</title>', `<title>Crucible</title>\n  <meta name="generator" content="Crucible ${pkg.version} (browser edition)">`);

// Third-party licence notices travel inside the single file.
const purifyNotice = 'DOMPurify 3 (https://github.com/cure53/DOMPurify), (c) Cure53 and other contributors,\n  used under the Apache License 2.0 (dual-licensed Apache-2.0 / MPL-2.0).\n  Full text: http://www.apache.org/licenses/LICENSE-2.0';
const markedLicense = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'marked', 'LICENSE'), 'utf8').replace(/--/g, '- -');
const ownLicense = fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8').replace(/--/g, '- -');
html = html.replace('<head>', () => `<head>\n<!--\n  Crucible ${pkg.version}: a free manuscript editor.\n\n${ownLicense.replace(/^/gm, '  ')}\n\n  ===========================================================================\n\n  Includes marked (https://github.com/markedjs/marked):\n${markedLicense.replace(/^/gm, '  ')}\n\n  Includes ${purifyNotice}\n-->`);

// Only Crucible's own scripts may run: each one is allowed by its exact
// fingerprint (SHA-256), so any script that found its way into the page,
// for example hidden in a manuscript, is refused by the browser.
// HTML parsers normalize CRLF and CR to LF before checking inline hashes.
// Normalize before hashing so Windows builds retain the same security policy.
html = html.replace(/\r\n?/g, '\n');
const crypto = require('crypto');
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
html = html.replace('__SCRIPT_HASHES__', hashes.join(' '));
if (/<script\s[^>]*src=/.test(html)) throw new Error('build-web: an external <script src> was left in the page');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'crucible.html'), html);
console.log(`Wrote dist-web/crucible.html (${(html.length / 1024).toFixed(0)} KB)`);
