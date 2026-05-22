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
  files.appendEntry('USER.md', 'pref-test-line', { projectSlug: '' });
  files.appendEntry('MEMORY.md', 'project-fact-line', { projectSlug: 'demo' });
  scope.writeActiveProject('demo');
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

test('composeContext includes full policy by default', () => {
  setStyle('full', 'policy-only');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.match(text, /PROACTIVE SAVE/);
  assert.match(text, /<memory-active-project>demo<\/memory-active-project>/);
  assert.match(text, /<memory-context>/);
  assert.match(text, /pref-test-line/);
  assert.match(text, /project-fact-line/);
});

test('composeContext compact mode shrinks policy', () => {
  setStyle('compact', 'policy-only');
  const { text } = inject.composeContext('/tmp/fake');
  assert.match(text, /<memory-policy>/);
  assert.doesNotMatch(text, /PROACTIVE SAVE/);
});

test('composeContext none mode omits policy block', () => {
  setStyle('none', 'policy-only');
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<memory-policy>/);
  assert.match(text, /<memory-context>/);
});

test('composeContext legacy-inject mode omits policy block', () => {
  setStyle('full', 'legacy-inject');
  const { text } = inject.composeContext('/tmp/fake');
  assert.doesNotMatch(text, /<memory-policy>/);
  assert.match(text, /<memory-context>/);
});
