'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf, readIfExists } = require('./_helpers');

let TMP;
let files, scope;

before(() => {
  TMP = mkTempHome();
  files = require('../lib/files');
  scope = require('../lib/scope');
});
after(() => rmRf(TMP));

test('appendEntry to USER.md goes to global memory dir', () => {
  const r = files.appendEntry('USER.md', 'prefer-korean-concise', { projectSlug: 'someproj', source: 'test' });
  assert.equal(r.ok, true);
  assert.equal(r.scope, 'global');
  assert.match(r.file, /[\\/]memory[\\/]USER\.md$/);
});

test('appendEntry to MEMORY.md with project slug routes to projects-memory', () => {
  const r = files.appendEntry('MEMORY.md', 'project-specific-fact', { projectSlug: 'demo', source: 'test' });
  assert.equal(r.ok, true);
  assert.equal(r.scope, 'project');
  assert.match(r.file, /projects-memory[\\/]demo[\\/]MEMORY\.md$/);
});

test('appendEntry rejects duplicate content', () => {
  const a = files.appendEntry('MEMORY.md', 'unique-test-string-x', { projectSlug: 'demo' });
  assert.equal(a.ok, true);
  const b = files.appendEntry('MEMORY.md', 'unique-test-string-x', { projectSlug: 'demo' });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'duplicate');
});

test('appendEntry rejects secret-shaped content', () => {
  const r = files.appendEntry('MEMORY.md', 'config password=hunter2supersecret', { projectSlug: 'demo' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'secret-blocked');
});

test('appendEntry rejects too-short content', () => {
  const r = files.appendEntry('MEMORY.md', 'ab', { projectSlug: 'demo' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-short');
});

test('parseEntries / serializeEntries roundtrip preserves bodies', () => {
  const r = files.appendEntry('FAILURES.md', 'roundtrip-test-entry', { projectSlug: 'demo' });
  const text = readIfExists(r.file);
  const parsed = files.parseEntries(text);
  assert.ok(parsed.entries.length >= 1);
  assert.ok(parsed.entries.some(e => e.body.includes('roundtrip-test-entry')));
});

test('replaceEntry updates existing entry', () => {
  files.appendEntry('FAILURES.md', 'replace-me-original', { projectSlug: 'demo' });
  const r = files.replaceEntry('FAILURES.md', 'replace-me-original', 'replace-me-updated', { projectSlug: 'demo' });
  assert.equal(r.ok, true);
  const text = readIfExists(r.file);
  assert.ok(text.includes('replace-me-updated'));
  assert.ok(!text.includes('replace-me-original'));
});

test('replaceEntry fails on no match', () => {
  const r = files.replaceEntry('FAILURES.md', 'no-such-content-xyz', 'new', { projectSlug: 'demo' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-found');
});

test('removeEntry deletes from markdown', () => {
  files.appendEntry('FAILURES.md', 'remove-target-entry', { projectSlug: 'demo' });
  const r = files.removeEntry('FAILURES.md', 'remove-target-entry', { projectSlug: 'demo' });
  assert.equal(r.ok, true);
  const text = readIfExists(r.file);
  assert.ok(!text.includes('remove-target-entry'));
});

test('FIFO eviction kicks in when memoryCharLimit exceeded', () => {
  // memoryCharLimit was seeded to 4000 in test helper
  for (let i = 0; i < 30; i++) {
    files.appendEntry('SKILLS.md', `eviction-test-entry-${i.toString().padStart(4, '0')}-` + 'x'.repeat(200), { projectSlug: 'demo' });
  }
  const text = readIfExists(path.join(TMP, '.claude', 'projects-memory', 'demo', 'SKILLS.md'));
  assert.ok(text.length <= 4500, `expected eviction below ~4000 chars, got ${text.length}`);
  // The newest entry must survive
  assert.ok(text.includes('eviction-test-entry-0029'));
});

test('listMemoryFiles returns project + global files for given slug', () => {
  const list = files.listMemoryFiles('demo');
  const targets = list.map(f => `${f.scope}/${f.target}`);
  assert.ok(targets.includes('global/USER.md'));
  assert.ok(targets.includes('project/MEMORY.md'));
  assert.ok(targets.includes('project/FAILURES.md'));
});

test('memoryOverflowStrategy=reject refuses new entry when limit exceeded', () => {
  // Switch strategy on a fresh target file
  const cfg = require('../lib/config');
  const fs = require('fs');
  const path = require('path');
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const json = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  json.memoryOverflowStrategy = 'reject';
  json.memoryCharLimit = 1500;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfg.resetConfig();
  // Fill to near limit (default header ~170 + entry framing ~70 + payload)
  const r1 = files.appendEntry('PROJECTS.md', 'reject-strategy-test-entry-' + 'x'.repeat(900), { projectSlug: 'demo' });
  assert.equal(r1.ok, true, `first add should succeed within limit; got ${r1.reason}`);
  const r2 = files.appendEntry('PROJECTS.md', 'second-entry-should-be-rejected-' + 'y'.repeat(900), { projectSlug: 'demo' });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'limit-exceeded');
  // Restore for subsequent tests
  json.memoryOverflowStrategy = 'fifo-evict';
  json.memoryCharLimit = 4000;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfg.resetConfig();
});

test('memoryOverflowStrategy=dedupe-first removes duplicates before FIFO', () => {
  const cfg = require('../lib/config');
  const fs = require('fs');
  const path = require('path');
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const json = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  json.memoryOverflowStrategy = 'dedupe-first';
  json.memoryCharLimit = 1500;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfg.resetConfig();
  // Just verify the strategy code path executes without error and respects limit
  for (let i = 0; i < 10; i++) {
    files.appendEntry('SKILLS.md', `dedupe-strategy-fresh-entry-${i}-` + 'z'.repeat(100), { projectSlug: 'demo' });
  }
  const txt = fs.readFileSync(path.join(TMP, '.claude', 'projects-memory', 'demo', 'SKILLS.md'), 'utf8');
  assert.ok(txt.length <= 1700, `expected limit ~1500, got ${txt.length}`);
  // Restore
  json.memoryOverflowStrategy = 'fifo-evict';
  json.memoryCharLimit = 4000;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfg.resetConfig();
});
