'use strict';
const { normalize, appendEntry } = require('./files');
const { loadConfig } = require('./config');

const PATTERNS = {
  explicitMemory: /(기억해|기억해줘|메모해|저장해|remember this|note this|save this)/i,
  preference: /(앞으로|항상|선호|좋아해|싫어해|prefer|preference|always|from now on|never)/i,
  correction: /(아니야|아니에요|그게 아니라|하지마|하지 ?말|틀렸|수정해|no actually|don't do|do not|actually that's wrong)/i,
  failure: /(안 ?됐|실패|에러|오류|작동 안|failed|failure|error|didn't work|doesn't work|broken)/i,
  convention: /(우리는|이 ?프로젝트는|이 ?레포는|we use|we always|this repo uses|this project uses|convention is)/i,
};

function stripMarker(s) {
  return s
    .replace(/^.*?(?:기억해줘?|메모해|저장해|remember this|note this|save this)[:：,\s-]*/i, '')
    .trim();
}

function classifyAndSave(text, meta = {}) {
  const cfg = loadConfig();
  const s = normalize(text);
  if (!s) return [];
  const saved = [];
  let extracted = stripMarker(s);
  if (extracted.length < 4) extracted = s;

  const slug = meta.projectSlug || '';
  const baseMeta = { ...meta };

  if (PATTERNS.preference.test(s) || PATTERNS.explicitMemory.test(s)) {
    const target = PATTERNS.preference.test(s) ? 'USER.md' : 'MEMORY.md';
    const r = appendEntry(target, extracted, { ...baseMeta, category: PATTERNS.preference.test(s) ? 'preference' : 'insight', projectSlug: target === 'USER.md' ? '' : slug });
    if (r.ok) saved.push({ target, scope: r.scope });
  }
  if (cfg.correctionDetection && PATTERNS.correction.test(s)) {
    const r = appendEntry('FAILURES.md', `Correction: ${extracted}`, { ...baseMeta, category: 'correction', projectSlug: slug });
    if (r.ok) saved.push({ target: 'FAILURES.md', scope: r.scope });
  }
  if (PATTERNS.failure.test(s)) {
    const r = appendEntry('FAILURES.md', `Failure: ${extracted}`, { ...baseMeta, category: 'failure', projectSlug: slug });
    if (r.ok) saved.push({ target: 'FAILURES.md', scope: r.scope });
  }
  if (PATTERNS.convention.test(s) && slug) {
    const r = appendEntry('CONVENTIONS.md', extracted, { ...baseMeta, category: 'convention', projectSlug: slug });
    if (r.ok) saved.push({ target: 'CONVENTIONS.md', scope: r.scope });
  }
  return saved;
}

module.exports = { classifyAndSave, PATTERNS };
