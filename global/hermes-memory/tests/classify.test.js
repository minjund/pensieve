'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let classify;

before(() => {
  TMP = mkTempHome();
  classify = require('../lib/classify');
});
after(() => rmRf(TMP));

test('Korean preference keyword "앞으로" routes to USER.md', () => {
  const saved = classify.classifyAndSave('앞으로는 Tailwind 말고 vanilla CSS 써.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('USER.md'));
});

test('Korean "기억해" routes to MEMORY.md (project-scoped)', () => {
  const saved = classify.classifyAndSave('이거 기억해: 이 레포는 vitest 사용한다.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('MEMORY.md'));
});

test('Korean correction "아니야" routes to FAILURES.md', () => {
  const saved = classify.classifyAndSave('아니야, 그 방식 하지마.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('FAILURES.md'));
});

test('Korean failure word "실패" routes to FAILURES.md', () => {
  const saved = classify.classifyAndSave('webhook 검증 빠뜨려서 prod에서 결제 중복 실패 발생.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('FAILURES.md'));
});

test('English "always" routes to USER.md', () => {
  const saved = classify.classifyAndSave('Always run tests before pushing.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('USER.md'));
});

test('Convention phrase "이 프로젝트는" with active project routes to CONVENTIONS.md', () => {
  const saved = classify.classifyAndSave('이 프로젝트는 grafana 대시보드로 모니터링한다.', { projectSlug: 'demo', source: 'test' });
  const targets = saved.map(s => s.target);
  assert.ok(targets.includes('CONVENTIONS.md'));
});

test('Plain greeting does not trigger any save', () => {
  const saved = classify.classifyAndSave('안녕하세요!', { projectSlug: 'demo', source: 'test' });
  assert.equal(saved.length, 0);
});
