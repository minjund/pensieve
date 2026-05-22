'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let skills;

before(() => {
  TMP = mkTempHome();
  skills = require('../lib/skills');
});
after(() => rmRf(TMP));

test('createSkill creates a global skill with frontmatter and sections', () => {
  const r = skills.createSkill({
    scope: 'global',
    name: 'deploy-canary',
    description: '5% canary then promote',
    trigger: '/deploy',
    sections: {
      when_to_use: 'when shipping risky changes',
      procedure_steps: 'build/canary/watch/promote',
      pitfalls: 'forgetting to flip flag',
      verification_steps: 'p99 stable',
    },
  });
  assert.equal(r.ok, true);
  const view = skills.viewSkill({ scope: 'global', name: 'deploy-canary' });
  assert.equal(view.ok, true);
  assert.equal(view.frontmatter.name, 'deploy-canary');
  assert.ok(view.body.includes('## When to use'));
  assert.ok(view.body.includes('## Procedure'));
});

test('createSkill rejects exact slug collision by default', () => {
  const r = skills.createSkill({ scope: 'global', name: 'deploy-canary', description: 'dup attempt' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'slug-collision');
});

test('checkConflicts surfaces near-name (Levenshtein)', () => {
  const conflicts = skills.checkConflicts({ scope: 'global', slug: '', name: 'deploy-canery', description: 'unrelated' });
  const kinds = conflicts.map(c => c.kind);
  assert.ok(kinds.includes('near-name'));
});

test('checkConflicts surfaces similar-description (Jaccard)', () => {
  const conflicts = skills.checkConflicts({ scope: 'global', slug: '', name: 'totally-different-name', description: '5% canary then promote' });
  const kinds = conflicts.map(c => c.kind);
  assert.ok(kinds.includes('similar-description'));
});

test('patchSkill updates a section idempotently', () => {
  const r = skills.patchSkill({ scope: 'global', name: 'deploy-canary', sectionKey: 'pitfalls', newContent: 'never promote without flag flip' });
  assert.equal(r.ok, true);
  const view = skills.viewSkill({ scope: 'global', name: 'deploy-canary' });
  assert.ok(view.body.includes('never promote without flag flip'));
});

test('patchSkill falls back from project to global when project not found', () => {
  const r = skills.patchSkill({ scope: 'project', project: 'nonexistent', name: 'deploy-canary', sectionKey: 'pitfalls', newContent: 'new pitfall via fallback' });
  assert.equal(r.ok, true, `fallback should find global skill, got ${r.reason}`);
});

test('updateSkill rewrites description', () => {
  const r = skills.updateSkill({ scope: 'global', name: 'deploy-canary', description: 'new description text' });
  assert.equal(r.ok, true);
  const view = skills.viewSkill({ scope: 'global', name: 'deploy-canary' });
  assert.equal(view.frontmatter.description, 'new description text');
});

test('deleteSkill removes the directory', () => {
  const r = skills.deleteSkill({ scope: 'global', name: 'deploy-canary' });
  assert.equal(r.ok, true);
  const view = skills.viewSkill({ scope: 'global', name: 'deploy-canary' });
  assert.equal(view.ok, false);
  assert.equal(view.reason, 'not-found');
});

test('Levenshtein distance is correct', () => {
  assert.equal(skills.levenshtein('canary', 'canary'), 0);
  assert.equal(skills.levenshtein('canary', 'canery'), 1);
  assert.equal(skills.levenshtein('foo', 'bar'), 3);
});

test('Jaccard similarity is correct for identical and disjoint', () => {
  assert.equal(skills.tokenJaccard('a b c', 'a b c'), 1);
  assert.equal(skills.tokenJaccard('a b c', 'x y z'), 0);
});
