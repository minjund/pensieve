'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { containsSecret } = require('../lib/secrets');

test('blocks Stripe-style secret keys', () => {
  assert.equal(containsSecret('here is sk_test_abcdefghijklmnopqrstuvwxyz1234567890'), true);
  assert.equal(containsSecret('pk_live_aaaaaaaaaaaaaaaaaaaaaaaa'), true);
});

test('blocks GitHub PAT', () => {
  assert.equal(containsSecret('token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(containsSecret('github_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true);
});

test('blocks AWS access key ID', () => {
  assert.equal(containsSecret('AKIAIOSFODNN7EXAMPLE'), true);
});

test('blocks Google API key shape', () => {
  // Real Google API key = "AIza" + exactly 35 alphanumeric chars
  const key = 'AIza' + 'A'.repeat(35);
  assert.equal(containsSecret('key=' + key), true);
});

test('blocks Slack tokens', () => {
  assert.equal(containsSecret('xoxb-12345-abcdefghijklmnopqrstuvwx'), true);
});

test('blocks JWT-like triples', () => {
  assert.equal(containsSecret('Bearer eyJabcdefghijklmnopqrst.abcdefghij.klmnopqrst'), true);
});

test('blocks BEGIN PRIVATE KEY headers', () => {
  assert.equal(containsSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
  assert.equal(containsSecret('-----BEGIN OPENSSH PRIVATE KEY-----'), true);
});

test('blocks key=value secret assignment', () => {
  assert.equal(containsSecret('password=hunter2supersecret'), true);
  assert.equal(containsSecret('api_key: abcdefghijklmnop'), true);
});

test('allows benign Korean / English text', () => {
  assert.equal(containsSecret('이 레포는 pnpm 사용함'), false);
  assert.equal(containsSecret('Use pnpm not npm in this project'), false);
  assert.equal(containsSecret('PostToolUse 훅 카운터로 background-review.js spawn'), false);
});

test('allows short alphanumeric strings that are not secret shapes', () => {
  assert.equal(containsSecret('abc123'), false);
  assert.equal(containsSecret('config v1.2.3'), false);
});
