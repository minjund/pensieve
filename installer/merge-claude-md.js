'use strict';
const fs = require('fs');
const path = require('path');

const snippetPath = process.argv[2];
if (!snippetPath) { console.error('snippet path required'); process.exit(1); }

const home = process.env.USERPROFILE || process.env.HOME;
const target = path.join(home, '.claude', 'CLAUDE.md');

const snippet = fs.readFileSync(snippetPath, 'utf8');

let existing = '';
try { existing = fs.readFileSync(target, 'utf8'); } catch {}

const marker = /(^|\n)#\s*(Global Claude Memory|Claude Hermes Memory)\b/i;

if (existing.length === 0) {
  fs.writeFileSync(target, snippet);
  console.log('CLAUDE.md created');
} else if (marker.test(existing)) {
  console.log('CLAUDE.md already contains Hermes section; skipping');
} else {
  const sep = existing.endsWith('\n') ? '\n---\n\n' : '\n\n---\n\n';
  fs.writeFileSync(target, existing + sep + snippet);
  console.log('CLAUDE.md appended');
}
