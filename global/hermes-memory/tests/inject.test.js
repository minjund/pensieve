'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let inject, files, scope, config;

before(() => {
  TMP = mkTempHome();
  inject = require('../lib/inject');
  files = require('../lib/files');
  scope = require('../lib/scope');
  config = require('../lib/config');
  // Seed entries
  files.appendEntry('USER.md', 'pref-test-line', { projectSlug: '' });           // global-only
  files.appendEntry('MEMORY.md', 'global-digest-fact', { projectSlug: '' });      // global bulk → digest
  files.appendEntry('MEMORY.md', 'project-fact-line', { projectSlug: 'demo' });   // project
  scope.writeActiveProject('demo');
  // Seed a global behavior card (always-on rules file)
  fs.writeFileSync(path.join(scope.globalDir(), inject.BEHAVIOR_FILE), '- 한국어 존댓말 사용 (반말 금지).\n', 'utf8');
  // Seed curated summary cards (global + project) for the project-summary block
  fs.writeFileSync(path.join(scope.globalDir(), inject.SUMMARY_FILE), 'Global overview line.\n', 'utf8');
  fs.writeFileSync(path.join(scope.projectDir('demo'), inject.SUMMARY_FILE), 'Demo project: building X, currently at step Y.\n', 'utf8');
});
after(() => rmRf(TMP));

function setStyle(style, mode) {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryPolicyStyle = style;
  if (mode) cfg.memoryMode = mode;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
}

test('project mode (default): injects project memory + behavior card + global digest, NOT global bulk dump', () => {
  setStyle('full', 'project');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.match(text, /<memory-active-project>demo<\/memory-active-project>/);
  assert.match(text, /<behavior-rules>/);
  assert.match(text, /존댓말/);
  // Project memory is dumped verbatim
  assert.match(text, /<memory-context>/);
  assert.match(text, /project-fact-line/);
  // Global bulk is NOT dumped verbatim (no global USER pref line in the dump)
  assert.doesNotMatch(text, /pref-test-line/);
  // ...but global cross-project memory rides along as a condensed digest
  assert.match(text, /<global-digest>/);
  assert.match(text, /global-digest-fact/);
});

test('policy-only mode: policy + always-on cards only, no verbatim dump and no digest', () => {
  setStyle('full', 'policy-only');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.match(text, /<behavior-rules>/);
  // The bulk verbatim dump and the global digest are both suppressed in policy-only.
  assert.doesNotMatch(text, /<memory-context>/);
  assert.doesNotMatch(text, /<global-digest>/);
  // Lightweight always-on cards (identity/behavior/summary/continuity) still ride along.
});

test('compact style shrinks the policy block', () => {
  setStyle('compact', 'project');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.doesNotMatch(text, /PROACTIVE SAVE/);
});

test('inject mode includes policy + the FULL dump (global + project), no digest', () => {
  setStyle('full', 'inject');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.match(text, /<behavior-rules>/);
  assert.match(text, /<memory-context>/);
  assert.match(text, /pref-test-line/);     // global dumped
  assert.match(text, /project-fact-line/);  // project dumped
  assert.doesNotMatch(text, /<global-digest>/);
});

test('none style omits the policy block but dump still present in inject mode', () => {
  setStyle('none', 'inject');
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<memory-policy>/);
  assert.match(text, /<memory-context>/);
});

test('legacy-inject mode omits the policy block but keeps the full dump', () => {
  setStyle('full', 'legacy-inject');
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<memory-policy>/);
  assert.match(text, /<memory-context>/);
  assert.match(text, /pref-test-line/);
});

test('behavior card is injected across modes (project and legacy-inject)', () => {
  setStyle('full', 'project');
  assert.match(inject.composeContext('/tmp/fake').text, /<behavior-rules>/);
  setStyle('full', 'legacy-inject');
  assert.match(inject.composeContext('/tmp/fake').text, /<behavior-rules>/);
});

test('light mode keeps identity/behavior/recall but drops dump + digest', () => {
  setStyle('full', 'project');
  const { text } = inject.composeContext('/tmp/fake', { light: true });
  assert.match(text, /<memory-policy>/);
  assert.match(text, /<behavior-rules>/);
  assert.match(text, /<recall-behavior>/);
  assert.match(text, /<who>/);
  assert.doesNotMatch(text, /<memory-context>/);
  assert.doesNotMatch(text, /<global-digest>/);
});

test('recall-behavior policy is always present', () => {
  setStyle('full', 'project');
  assert.match(inject.composeContext('/tmp/fake').text, /기억 안 난다/);
});

test('auto-recall injects <recalled-memory> when prompt matches saved memory', () => {
  setStyle('full', 'project');
  // 'global-digest-fact' was seeded into global MEMORY.md; a prompt mentioning it
  // should surface it via FTS (no-op cleanly if better-sqlite3 is absent).
  const { text } = inject.composeContext('/tmp/fake', { light: true, prompt: 'global-digest-fact 관련해서 뭐였지' });
  if (/<recalled-memory>/.test(text)) {
    assert.match(text, /global-digest-fact/);
  }
});

test('project-summary card injects curated SUMMARY.md, pinned above the dump', () => {
  setStyle('full', 'project');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<project-summary>/);
  assert.match(text, /currently at step Y/);
  // Pinned ABOVE the verbatim dump so it survives the snapshot char cap.
  assert.ok(text.indexOf('<project-summary>') < text.indexOf('<memory-context>'));
});

test('continuity card surfaces the most recent saved project entry, above the dump', () => {
  setStyle('full', 'project');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<continuity>/);
  assert.match(text, /project-fact-line/);
  assert.ok(text.indexOf('<continuity>') < text.indexOf('<memory-context>'));
});

test('summary + continuity survive in light mode (when dump + digest are dropped)', () => {
  setStyle('full', 'project');
  const { text } = inject.composeContext('/tmp/fake', { light: true });
  assert.match(text, /<project-summary>/);
  assert.match(text, /<continuity>/);
  assert.doesNotMatch(text, /<memory-context>/);
  assert.doesNotMatch(text, /<global-digest>/);
});

// ─── Entry-level newest-first merge (dumpMergeByDate) ───
// Seed a separate project with dated entries spread across two files so we can
// assert ordering/dedup/overflow without depending on today's date.
function seedMergeProject() {
  const dir = scope.projectDir('mergeproj');
  fs.mkdirSync(dir, { recursive: true });
  const S = '\n§\n\n';
  const mem = '# MEMORY\n' + S +
    '## 2026-01-01\n\n- oldest-mem-fact\n<!-- date=2026-01-01 -->\n' + S +
    '## 2026-06-09\n\n- newest-mem-fact\n<!-- date=2026-06-09 -->\n';
  const conv = '# CONVENTIONS\n' + S +
    '## 2026-03-15\n\n- middle-conv-fact\n<!-- date=2026-03-15 -->\n' + S +
    '## 2026-03-15\n\n- newest-mem-fact\n<!-- date=2026-03-15 -->\n'; // dup of mem content
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), mem, 'utf8');
  fs.writeFileSync(path.join(dir, 'CONVENTIONS.md'), conv, 'utf8');
}

test('dumpMergeByDate: entries merged newest-first across files (fresh wins over old)', () => {
  seedMergeProject();
  setStyle('full', 'project');
  const { text } = inject.buildMemoryBlock('/x', { projectSlug: 'mergeproj', scopes: { global: false, project: true } });
  // 2026-06-09 entry must precede 2026-03-15 which must precede 2026-01-01
  assert.ok(text.indexOf('newest-mem-fact') < text.indexOf('middle-conv-fact'), 'newest before middle');
  assert.ok(text.indexOf('middle-conv-fact') < text.indexOf('oldest-mem-fact'), 'middle before oldest');
  // Lines carry date + file label
  assert.match(text, /- \[2026-06-09 MEMORY\] newest-mem-fact/);
  assert.match(text, /- \[2026-03-15 CONVENTIONS\] middle-conv-fact/);
});

test('dumpMergeByDate: dedupes a fact repeated across files', () => {
  seedMergeProject();
  setStyle('full', 'project');
  const { text } = inject.buildMemoryBlock('/x', { projectSlug: 'mergeproj', scopes: { global: false, project: true } });
  const hits = (text.match(/newest-mem-fact/g) || []).length;
  assert.equal(hits, 1, 'duplicated content appears only once');
});

test('dumpMergeByDate: overflow past injectCharLimit drops oldest with a search pointer', () => {
  seedMergeProject();
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.injectCharLimit = 60; // tiny: only the newest entry fits
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  const { text } = inject.buildMemoryBlock('/x', { projectSlug: 'mergeproj', scopes: { global: false, project: true } });
  assert.match(text, /newest-mem-fact/);          // newest survives
  assert.doesNotMatch(text, /oldest-mem-fact/);    // oldest dropped
  assert.match(text, /use \/memory-search/);       // pointer present
});

test('dumpMergeByDate:false falls back to legacy per-file tail dump', () => {
  seedMergeProject();
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.injectCharLimit = 8000; // restore: a prior test shrank this to 60
  cfg.dumpMergeByDate = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  const { text } = inject.buildMemoryBlock('/x', { projectSlug: 'mergeproj', scopes: { global: false, project: true } });
  // Legacy format keeps the per-file "## project[slug]/NAME" headers
  assert.match(text, /## project\[mergeproj\]\/MEMORY\.md/);
});

test('behaviorCardEnabled:false disables the card', () => {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.behaviorCardEnabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<behavior-rules>/);
});

test('globalDigestEnabled:false disables the digest in project mode', () => {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.behaviorCardEnabled = true;
  cfg.globalDigestEnabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<global-digest>/);
  assert.match(text, /project-fact-line/);
});

test('summaryCardEnabled:false disables the project-summary card', () => {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.summaryCardEnabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  assert.doesNotMatch(inject.composeContext('/tmp/fake').text, /<project-summary>/);
});

test('continuityEnabled:false disables the continuity card', () => {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.memoryMode = 'project';
  cfg.memoryPolicyStyle = 'full';
  cfg.continuityEnabled = false;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  config.resetConfig();
  assert.doesNotMatch(inject.composeContext('/tmp/fake').text, /<continuity>/);
});
