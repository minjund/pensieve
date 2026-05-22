'use strict';
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, PROJECTS_MEMORY_ROOT } = require('./paths');
const { loadConfig } = require('./config');
const { sanitizeSlug } = require('./scope');
const { containsSecret } = require('./secrets');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function globalSkillsDir() { return path.join(CLAUDE_DIR, 'skills'); }
function projectSkillsDir(slug) { return path.join(PROJECTS_MEMORY_ROOT, slug, 'skills'); }

function skillsRoot(scope, slug) {
  if (scope === 'project' && slug) return projectSkillsDir(slug);
  return globalSkillsDir();
}

function skillDir(scope, slug, skillSlug) {
  return path.join(skillsRoot(scope, slug), skillSlug);
}
function skillFile(scope, slug, skillSlug) {
  return path.join(skillDir(scope, slug, skillSlug), 'SKILL.md');
}

function listSkills(scope, slug) {
  const root = skillsRoot(scope, slug);
  if (!exists(root)) return [];
  return fs.readdirSync(root)
    .filter(n => { try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; } })
    .map(n => ({ slug: n, file: path.join(root, n, 'SKILL.md'), exists: exists(path.join(root, n, 'SKILL.md')) }));
}

function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { fm: {}, body: text || '' };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fm: {}, body: text };
  const header = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\s*\n/, '');
  const fm = {};
  for (const line of header.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  return { fm, body };
}

function serializeSkill({ name, description, trigger, scope, project, sections }) {
  const fm = ['---'];
  if (name) fm.push(`name: ${name}`);
  if (description) fm.push(`description: ${description}`);
  if (trigger) fm.push(`trigger: ${trigger}`);
  if (scope) fm.push(`scope: ${scope}`);
  if (project) fm.push(`project: ${project}`);
  fm.push('---', '');
  const body = [];
  body.push(`# ${name}`);
  body.push('');
  if (sections && sections.when_to_use) {
    body.push('## When to use', '', sections.when_to_use.trim(), '');
  }
  if (sections && sections.procedure_steps) {
    body.push('## Procedure', '', sections.procedure_steps.trim(), '');
  }
  if (sections && sections.pitfalls) {
    body.push('## Pitfalls', '', sections.pitfalls.trim(), '');
  }
  if (sections && sections.verification_steps) {
    body.push('## Verification', '', sections.verification_steps.trim(), '');
  }
  return fm.join('\n') + body.join('\n').trimEnd() + '\n';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) m[i][j] = m[i - 1][j - 1];
      else m[i][j] = Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

function tokenJaccard(a, b) {
  const t1 = new Set(String(a || '').toLowerCase().split(/\W+/).filter(Boolean));
  const t2 = new Set(String(b || '').toLowerCase().split(/\W+/).filter(Boolean));
  if (!t1.size && !t2.size) return 1;
  let inter = 0;
  for (const x of t1) if (t2.has(x)) inter += 1;
  const uni = t1.size + t2.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function checkConflicts({ scope, slug, name, description }) {
  const cfg = loadConfig();
  const issues = [];
  const candidates = [
    ...listSkills('global', '').map(s => ({ ...s, scope: 'global' })),
    ...(slug ? listSkills('project', slug).map(s => ({ ...s, scope: 'project' })) : []),
  ];
  for (const c of candidates) {
    if (c.slug === name) { issues.push({ kind: 'exact-slug', conflict: c }); continue; }
    const dist = levenshtein(c.slug, name);
    if (dist <= cfg.skillNameDistanceThreshold) issues.push({ kind: 'near-name', conflict: c, distance: dist });
    if (description && exists(c.file)) {
      const { fm } = parseFrontmatter(readText(c.file));
      const sim = tokenJaccard(fm.description || '', description);
      if (sim >= cfg.skillSimilarityThreshold) issues.push({ kind: 'similar-description', conflict: c, similarity: sim });
    }
  }
  return issues;
}

function createSkill(input) {
  const { scope = 'global', project = '', name, description, trigger, sections = {}, allowConflicts = false } = input;
  if (!name) return { ok: false, reason: 'missing-name' };
  const slug = sanitizeSlug(name);
  if (!slug) return { ok: false, reason: 'invalid-name' };
  const projectSlug = scope === 'project' && project ? sanitizeSlug(project) : '';
  if (containsSecret(description || '') || containsSecret(JSON.stringify(sections))) {
    return { ok: false, reason: 'secret-blocked' };
  }
  try {
    const cfgSk = loadConfig();
    if (cfgSk.blockPromptInjection !== false) {
      const { containsInjection } = require('./content-scanner');
      const blob = (description || '') + '\n' + JSON.stringify(sections || {});
      if (containsInjection(blob)) return { ok: false, reason: 'injection-blocked' };
    }
  } catch {}
  const conflicts = checkConflicts({ scope, slug: projectSlug, name: slug, description });
  const blocking = conflicts.filter(c => c.kind === 'exact-slug');
  if (blocking.length && !allowConflicts) {
    return { ok: false, reason: 'slug-collision', conflicts: blocking };
  }
  const filePath = skillFile(scope, projectSlug, slug);
  if (exists(filePath) && !allowConflicts) return { ok: false, reason: 'exists' };
  const content = serializeSkill({ name: slug, description, trigger, scope, project: projectSlug, sections });
  writeText(filePath, content);
  return { ok: true, file: filePath, slug, scope, project: projectSlug, conflicts };
}

function resolveSkillFile(scope, project, slug) {
  const projectSlug = project ? sanitizeSlug(project) : '';
  const requestedScope = scope || 'global';
  const primary = skillFile(requestedScope, projectSlug, slug);
  if (exists(primary)) return { file: primary, scope: requestedScope, project: requestedScope === 'project' ? projectSlug : '' };
  const fallbackScope = requestedScope === 'project' ? 'global' : 'project';
  const fallback = fallbackScope === 'project' && projectSlug
    ? skillFile('project', projectSlug, slug)
    : skillFile('global', '', slug);
  if (exists(fallback)) return { file: fallback, scope: fallbackScope, project: fallbackScope === 'project' ? projectSlug : '' };
  return null;
}

function viewSkill({ scope, project, name }) {
  const slug = sanitizeSlug(name || '');
  if (!slug) {
    const list = [
      ...listSkills('global', '').map(s => ({ scope: 'global', ...s })),
      ...(project ? listSkills('project', sanitizeSlug(project)).map(s => ({ scope: 'project', ...s })) : []),
    ];
    return { ok: true, skills: list };
  }
  const resolved = resolveSkillFile(scope, project, slug);
  if (!resolved) return { ok: false, reason: 'not-found' };
  const text = readText(resolved.file);
  const { fm, body } = parseFrontmatter(text);
  return { ok: true, file: resolved.file, scope: resolved.scope, project: resolved.project, frontmatter: fm, body, raw: text };
}

function patchSkill({ scope = 'global', project = '', name, sectionKey, newContent }) {
  const slug = sanitizeSlug(name);
  if (!slug || !sectionKey || newContent == null) return { ok: false, reason: 'missing-args' };
  if (containsSecret(newContent)) return { ok: false, reason: 'secret-blocked' };
  try {
    const cfgPa = loadConfig();
    if (cfgPa.blockPromptInjection !== false) {
      const { containsInjection } = require('./content-scanner');
      if (containsInjection(newContent)) return { ok: false, reason: 'injection-blocked' };
    }
  } catch {}
  const resolved = resolveSkillFile(scope, project, slug);
  if (!resolved) return { ok: false, reason: 'not-found' };
  const filePath = resolved.file;
  const text = readText(filePath);
  const headerToTitle = {
    when_to_use: 'When to use',
    procedure_steps: 'Procedure',
    pitfalls: 'Pitfalls',
    verification_steps: 'Verification',
  };
  const title = headerToTitle[sectionKey] || sectionKey;
  const re = new RegExp(`(##\\s+${title}\\n)([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  let out;
  if (re.test(text)) {
    out = text.replace(re, `$1\n${newContent.trim()}\n\n`);
  } else {
    out = text.trimEnd() + `\n\n## ${title}\n\n${newContent.trim()}\n`;
  }
  writeText(filePath, out);
  return { ok: true, file: filePath };
}

function updateSkill({ scope = 'global', project = '', name, description, body }) {
  const slug = sanitizeSlug(name);
  if (!slug) return { ok: false, reason: 'missing-name' };
  const resolved = resolveSkillFile(scope, project, slug);
  if (!resolved) return { ok: false, reason: 'not-found' };
  const filePath = resolved.file;
  if (containsSecret(description || '') || containsSecret(body || '')) return { ok: false, reason: 'secret-blocked' };
  try {
    const cfgUp = loadConfig();
    if (cfgUp.blockPromptInjection !== false) {
      const { containsInjection } = require('./content-scanner');
      if (containsInjection((description || '') + '\n' + (body || ''))) return { ok: false, reason: 'injection-blocked' };
    }
  } catch {}
  const text = readText(filePath);
  const { fm } = parseFrontmatter(text);
  if (description != null) fm.description = description;
  const fmLines = ['---'];
  if (fm.name) fmLines.push(`name: ${fm.name}`);
  if (fm.description) fmLines.push(`description: ${fm.description}`);
  if (fm.trigger) fmLines.push(`trigger: ${fm.trigger}`);
  if (fm.scope) fmLines.push(`scope: ${fm.scope}`);
  if (fm.project) fmLines.push(`project: ${fm.project}`);
  fmLines.push('---', '');
  const finalBody = body != null ? body.trim() + '\n' : text.replace(/^---[\s\S]*?\n---\s*\n?/, '').trim() + '\n';
  writeText(filePath, fmLines.join('\n') + finalBody);
  return { ok: true, file: filePath };
}

function deleteSkill({ scope = 'global', project = '', name }) {
  const slug = sanitizeSlug(name);
  if (!slug) return { ok: false, reason: 'missing-name' };
  const resolved = resolveSkillFile(scope, project, slug);
  if (!resolved) return { ok: false, reason: 'not-found' };
  const dir = path.dirname(resolved.file);
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, dir };
}

module.exports = {
  listSkills,
  parseFrontmatter,
  serializeSkill,
  checkConflicts,
  createSkill,
  viewSkill,
  patchSkill,
  updateSkill,
  deleteSkill,
  skillsRoot,
  skillFile,
  levenshtein,
  tokenJaccard,
};
