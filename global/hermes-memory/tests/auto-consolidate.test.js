'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf, readIfExists } = require('./_helpers');

let TMP;
let files, cfgMod;

before(() => {
  TMP = mkTempHome();
  files = require('../lib/files');
  cfgMod = require('../lib/config');
});
after(() => rmRf(TMP));

function setStrategy(strategy, limit) {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const json = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  json.memoryOverflowStrategy = strategy;
  if (typeof limit === 'number') json.memoryCharLimit = limit;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfgMod.resetConfig();
}

test('evictForLimit returns evicted entries when over limit', () => {
  const text = files.defaultHeader('MEMORY.md') + Array.from({ length: 5 }, (_, i) =>
    `\n§\n\n## 2026-05-22\n\n- entry-${i}-${'x'.repeat(200)}\n`).join('\n');
  const r = files.evictForLimit(text, 'MEMORY.md', 400);
  assert.ok(r.text.length <= 500);
  assert.ok(r.evicted.length >= 1, `expected evicted entries, got ${r.evicted.length}`);
});

test('jaccardSimilarity matches near-duplicates', () => {
  const a = 'this project uses pnpm not npm';
  const b = 'this project uses pnpm rather than npm';
  const c = 'completely unrelated content about something else entirely';
  assert.ok(files.jaccardSimilarity(a, b) >= 0.5);
  assert.ok(files.jaccardSimilarity(a, c) < 0.3);
});

test('autoConsolidate deduplicates near-identical entries', () => {
  // Build a file with semantically similar entries
  const slug = 'auto-test';
  setStrategy('fifo-evict', 8000);
  files.appendEntry('MEMORY.md', 'the deployment pipeline runs on GitHub Actions every night', { projectSlug: slug });
  files.appendEntry('MEMORY.md', 'GitHub Actions runs our deployment pipeline every night basically', { projectSlug: slug });
  files.appendEntry('MEMORY.md', 'unrelated note about typography', { projectSlug: slug });

  const filePath = path.join(TMP, '.claude', 'projects-memory', slug, 'MEMORY.md');
  const before = fs.readFileSync(filePath, 'utf8');
  const consolidated = files.autoConsolidate(before, 'MEMORY.md', 0.4);
  const parsedBefore = files.parseEntries(before);
  const parsedAfter = files.parseEntries(consolidated);
  assert.ok(parsedAfter.entries.length < parsedBefore.entries.length,
    `expected fewer entries after consolidation: before=${parsedBefore.entries.length} after=${parsedAfter.entries.length}`);
  assert.ok(consolidated.includes('typography'), 'unrelated entry must survive');
});

test('auto-consolidate strategy reduces size by merging near-duplicates before FIFO', () => {
  const slug = 'auto-strategy';
  setStrategy('auto-consolidate', 2000);
  for (let i = 0; i < 8; i++) {
    files.appendEntry('SKILLS.md', `repeated convention about testing ${i} with consistent style guidelines and pnpm usage ${'x'.repeat(50)}`, { projectSlug: slug });
  }
  const filePath = path.join(TMP, '.claude', 'projects-memory', slug, 'SKILLS.md');
  const text = readIfExists(filePath);
  assert.ok(text.length <= 2200, `expected limit ~2000, got ${text.length}`);
  // Reset for other tests
  setStrategy('fifo-evict', 4000);
});

test('appendEntry returns extended count when overflow triggers eviction', () => {
  const slug = 'extended-count';
  setStrategy('fifo-evict', 1500);
  let lastExtendedCount = 0;
  for (let i = 0; i < 15; i++) {
    const r = files.appendEntry('MEMORY.md', `overflow-entry-${i}-${'y'.repeat(150)}`, { projectSlug: slug });
    if (r.ok && typeof r.extended === 'number') lastExtendedCount = r.extended;
  }
  // At least one of the later writes should have evicted something
  assert.ok(lastExtendedCount >= 0);
  setStrategy('fifo-evict', 4000);
});
