'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let scope;

before(() => {
  TMP = mkTempHome();
  scope = require('../lib/scope');
});
after(() => rmRf(TMP));

test('sanitizeSlug normalizes punctuation but does NOT extract basename', () => {
  assert.equal(scope.sanitizeSlug('My Repo!'), 'My-Repo');
  // sanitizeSlug just sanitizes characters; basename extraction is done by projectSlugFromCwd
  assert.equal(scope.sanitizeSlug('/tmp/path/to/my repo/'), 'tmp-path-to-my-repo');
  assert.equal(scope.sanitizeSlug(''), '');
  assert.equal(scope.sanitizeSlug('---weird---'), 'weird');
});

test('projectSlugFromCwd returns basename', () => {
  assert.equal(scope.projectSlugFromCwd('/tmp/foo/bar'), 'bar');
  assert.equal(scope.projectSlugFromCwd('/tmp/foo/bar/'), 'bar');
});

test('writeActiveProject + readActiveProject roundtrip', () => {
  scope.writeActiveProject('alpha-proj');
  assert.equal(scope.readActiveProject(), 'alpha-proj');
  scope.writeActiveProject('');
  assert.equal(scope.readActiveProject(), '');
});

test('resolveProjectSlug prefers explicit override, then active, then cwd', () => {
  scope.writeActiveProject('');
  assert.equal(scope.resolveProjectSlug('/tmp/foo/bar'), 'bar');
  scope.writeActiveProject('myrepo');
  assert.equal(scope.resolveProjectSlug('/tmp/foo/bar'), 'myrepo');
  assert.equal(scope.resolveProjectSlug('/tmp/foo/bar', 'override'), 'override');
});

test('projectDir creates and lists directories', () => {
  scope.projectDir('first');
  scope.projectDir('second');
  const list = scope.listProjectSlugs().sort();
  assert.ok(list.includes('first'));
  assert.ok(list.includes('second'));
});

test('targetDirFor routes USER.md to global, MEMORY.md to project when slug present', () => {
  const userDir = scope.targetDirFor('USER.md', 'alpha');
  const memDir = scope.targetDirFor('MEMORY.md', 'alpha');
  assert.ok(userDir.endsWith(path.join('.claude', 'memory')));
  assert.ok(memDir.endsWith(path.join('projects-memory', 'alpha')));
});
