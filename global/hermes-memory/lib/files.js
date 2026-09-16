'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { containsSecret } = require('./secrets');
const { targetDirFor, globalDir, projectDir } = require('./scope');
let _db = null;
function lazyDb() {
  if (_db === null) {
    try { _db = require('./db'); }
    catch { _db = { mirrorMemory: () => false, deleteMemoryByContent: () => 0, markAsExtended: () => 0 }; }
  }
  return _db;
}
function lazyMirror() { return lazyDb().mirrorMemory; }
function lazyDelete() { return lazyDb().deleteMemoryByContent; }

const SECTION = '§';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function nowDate() { return new Date().toISOString().slice(0, 10); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function normalize(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

function fileFor(target, slug) {
  const dir = targetDirFor(target, slug);
  return path.join(dir, target);
}

function defaultHeader(target) {
  const title = target.replace(/\.md$/i, '');
  return `# ${title}\n\nHermes memory store. Edit with /memory-add or /memory-remove. Entries separated by the section delimiter.\n\n`;
}

function ensureHeader(text, target) {
  const t = text || '';
  if (!t.trim()) return defaultHeader(target);
  return t;
}

function parseEntries(text) {
  // Returns { header, entries: [{ raw, body }] }
  const t = text || '';
  const idx = t.indexOf(SECTION);
  if (idx < 0) return { header: t, entries: [] };
  const header = t.slice(0, idx);
  const rest = t.slice(idx);
  const parts = rest.split(SECTION).map(x => x.trim()).filter(Boolean);
  const entries = parts.map(p => ({ raw: p, body: p }));
  return { header, entries };
}

function serializeEntries(header, entries) {
  if (!entries.length) return (header || '').trimEnd() + '\n';
  const blocks = entries.map(e => `\n${SECTION}\n\n${e.body.trim()}\n`).join('\n');
  return (header || '').trimEnd() + '\n' + blocks;
}

function evictForLimit(text, target, limit) {
  if (text.length <= limit) return { text, evicted: [] };
  const { header, entries } = parseEntries(text);
  const kept = [];
  const evicted = [];
  let size = (header || '').length;
  let stopped = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const block = `\n${SECTION}\n\n${entries[i].body}\n`;
    if (stopped || size + block.length > limit) {
      stopped = true;
      evicted.push(entries[i]);
      continue;
    }
    kept.unshift(entries[i]);
    size += block.length;
  }
  return { text: serializeEntries(header || defaultHeader(target), kept), evicted };
}

function jaccardSimilarity(a, b) {
  const tok = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9가-힣\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function autoConsolidate(text, target, threshold) {
  const parsed = parseEntries(text);
  const kept = [];
  for (let i = parsed.entries.length - 1; i >= 0; i--) {
    const candidate = parsed.entries[i];
    const cBody = extractEntryContent(candidate.body);
    const dup = kept.some(e => {
      const eBody = extractEntryContent(e.body);
      if (eBody.length < 8 || cBody.length < 8) return false;
      return jaccardSimilarity(eBody, cBody) >= threshold;
    });
    if (dup) continue;
    kept.unshift(candidate);
  }
  return serializeEntries(parsed.header || defaultHeader(target), kept);
}

function makeEntryBody(text, meta) {
  const lines = [];
  lines.push(`## ${nowDate()}`);
  lines.push('');
  lines.push(`- ${text}`);
  const tagLine = formatTagLine(meta);
  if (tagLine) lines.push(tagLine);
  return lines.join('\n');
}

function formatTagLine(meta) {
  const m = meta || {};
  const parts = [];
  if (m.source) parts.push(`source=${m.source}`);
  parts.push(`date=${nowDate()}`);
  if (m.category) parts.push(`category=${m.category}`);
  if (m.tag) parts.push(`tag=${m.tag}`);
  return `<!-- ${parts.join(' ')} -->`;
}

function appendEntry(target, text, meta = {}) {
  const cfg = loadConfig();
  const value = normalize(text);
  if (!value || value.length < 4) return { ok: false, reason: 'too-short' };
  if (containsSecret(value)) return { ok: false, reason: 'secret-blocked' };
  if (cfg.blockPromptInjection !== false) {
    try {
      const { containsInjection } = require('./content-scanner');
      if (containsInjection(value)) return { ok: false, reason: 'injection-blocked' };
    } catch {}
  }
  const slug = meta.projectSlug || '';
  const filePath = fileFor(target, slug);
  const current = ensureHeader(readText(filePath), target);
  if (current.includes(value)) return { ok: false, reason: 'duplicate' };
  const body = makeEntryBody(value, meta);
  let next = current.trimEnd() + `\n\n${SECTION}\n\n${body}\n`;
  let evictedEntries = [];
  if (next.length > cfg.memoryCharLimit) {
    const strategy = cfg.memoryOverflowStrategy || 'fifo-evict';
    if (strategy === 'reject') {
      return { ok: false, reason: 'limit-exceeded', limit: cfg.memoryCharLimit, attempted: next.length };
    }
    if (strategy === 'dedupe-first') {
      const parsed = parseEntries(next);
      const seen = new Set();
      const kept = [];
      for (let i = parsed.entries.length - 1; i >= 0; i--) {
        const key = parsed.entries[i].body.replace(/\s+/g, ' ').toLowerCase().slice(0, 400);
        if (seen.has(key)) continue;
        seen.add(key);
        kept.unshift(parsed.entries[i]);
      }
      next = serializeEntries(parsed.header || defaultHeader(target), kept);
      if (next.length > cfg.memoryCharLimit) {
        const r = evictForLimit(next, target, cfg.memoryCharLimit);
        next = r.text; evictedEntries = r.evicted;
      }
    } else if (strategy === 'auto-consolidate') {
      const threshold = typeof cfg.autoConsolidateThreshold === 'number' ? cfg.autoConsolidateThreshold : 0.85;
      next = autoConsolidate(next, target, threshold);
      if (next.length > cfg.memoryCharLimit) {
        const r = evictForLimit(next, target, cfg.memoryCharLimit);
        next = r.text; evictedEntries = r.evicted;
      }
    } else {
      const r = evictForLimit(next, target, cfg.memoryCharLimit);
      next = r.text; evictedEntries = r.evicted;
    }
  }
  writeText(filePath, next);
  const scope = slug && !cfg.globalOnlyTargets.includes(target) ? 'project' : 'global';
  try {
    lazyMirror()({
      scope,
      project: scope === 'project' ? slug : '',
      target,
      source: meta.source || '',
      category: meta.category || '',
      content: value,
    });
  } catch {}
  // Move FIFO-evicted entries to extended store (SQLite) so they remain searchable.
  if (cfg.extendedStoreEnabled !== false && evictedEntries.length) {
    try {
      const markExtended = lazyDb().markAsExtended;
      if (typeof markExtended === 'function') {
        for (const ev of evictedEntries) {
          const cBody = extractEntryContent(ev.body);
          if (cBody && cBody.length >= 4) markExtended({ scope, project: scope === 'project' ? slug : '', target, content: cBody });
        }
      }
    } catch {}
  }
  return { ok: true, target, file: filePath, scope, slug: scope === 'project' ? slug : '', content: value, extended: evictedEntries.length };
}

function listMemoryFiles(slug) {
  const out = [];
  const cfg = loadConfig();
  for (const target of cfg.globalOnlyTargets) {
    const p = path.join(globalDir(), target);
    if (exists(p)) out.push({ scope: 'global', target, path: p });
  }
  for (const target of ['MEMORY.md', 'FAILURES.md', 'SKILLS.md', 'PROJECTS.md']) {
    const p = path.join(globalDir(), target);
    if (exists(p)) out.push({ scope: 'global', target, path: p });
  }
  if (slug) {
    for (const target of cfg.projectScopedTargets) {
      const p = path.join(projectDir(slug), target);
      if (exists(p)) out.push({ scope: 'project', target, path: p, slug });
    }
  }
  return out;
}

function findMatchingEntry(filePath, query) {
  const text = readText(filePath);
  if (!text) return null;
  const { header, entries } = parseEntries(text);
  const q = normalize(query).toLowerCase();
  if (!q) return null;
  const idx = entries.findIndex(e => e.body.toLowerCase().includes(q));
  if (idx < 0) return null;
  return { header, entries, index: idx };
}

function replaceEntry(target, query, newText, meta = {}) {
  if (containsSecret(newText)) return { ok: false, reason: 'secret-blocked' };
  const cfgRE = loadConfig();
  if (cfgRE.blockPromptInjection !== false) {
    try {
      const { containsInjection } = require('./content-scanner');
      if (containsInjection(newText)) return { ok: false, reason: 'injection-blocked' };
    } catch {}
  }
  const slug = meta.projectSlug || '';
  const filePath = fileFor(target, slug);
  const m = findMatchingEntry(filePath, query);
  if (!m) return { ok: false, reason: 'not-found' };
  const body = makeEntryBody(normalize(newText), meta);
  m.entries[m.index] = { raw: body, body };
  writeText(filePath, serializeEntries(m.header || defaultHeader(target), m.entries));
  return { ok: true, target, file: filePath };
}

function extractEntryContent(body) {
  // Body shape:
  //   ## YYYY-MM-DD
  //
  //   - <text>
  //   <!-- ... -->
  const m = /^\s*-\s+([\s\S]*?)(?:\n<!--|$)/m.exec(body);
  if (m && m[1]) return normalize(m[1]);
  return normalize(body);
}

function removeEntry(target, query, meta = {}) {
  const cfg = loadConfig();
  const slug = meta.projectSlug || '';
  const filePath = fileFor(target, slug);
  const m = findMatchingEntry(filePath, query);
  if (!m) return { ok: false, reason: 'not-found' };
  const removed = m.entries.splice(m.index, 1)[0];
  writeText(filePath, serializeEntries(m.header || defaultHeader(target), m.entries));
  const scope = slug && !cfg.globalOnlyTargets.includes(target) ? 'project' : 'global';
  try {
    lazyDelete()({
      scope,
      project: scope === 'project' ? slug : '',
      target,
      content: extractEntryContent(removed.body),
    });
  } catch {}
  return { ok: true, target, file: filePath, removed: removed.body };
}

function consolidateFile(filePath) {
  const text = readText(filePath);
  if (!text) return { ok: true, kept: 0 };
  const { header, entries } = parseEntries(text);
  const seen = new Set();
  const kept = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const key = entries[i].body.replace(/\s+/g, ' ').toLowerCase().slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.unshift(entries[i]);
  }
  writeText(filePath, serializeEntries(header || '', kept));
  return { ok: true, kept: kept.length, removed: entries.length - kept.length };
}

// Jaccard-similarity dedupe: collapses near-duplicate entries (differ only by
// spacing/particles/punctuation). Removed entries are deleted from the SQLite mirror.
function consolidateFileSimilar(filePath, threshold) {
  const text = readText(filePath);
  if (!text) return { ok: true, kept: 0, removed: 0 };
  const target = path.basename(filePath);
  const before = parseEntries(text);
  if (before.entries.length < 2) return { ok: true, kept: before.entries.length, removed: 0 };
  const th = typeof threshold === 'number' ? threshold : 0.85;
  const next = autoConsolidate(text, target, th);
  const after = parseEntries(next);
  const removedBodies = before.entries
    .filter(e => !after.entries.some(k => k.body === e.body))
    .map(e => extractEntryContent(e.body))
    .filter(c => c && c.length >= 4);
  writeText(filePath, next);
  if (removedBodies.length) {
    try {
      const cfg = loadConfig();
      const slugMatch = /projects-memory[\\/]([^\\/]+)[\\/]/.exec(filePath);
      const scope = slugMatch && !cfg.globalOnlyTargets.includes(target) ? 'project' : 'global';
      const del = lazyDelete();
      for (const c of removedBodies) {
        del({ scope, project: scope === 'project' ? slugMatch[1] : '', target, content: c });
      }
    } catch {}
  }
  return { ok: true, kept: after.entries.length, removed: before.entries.length - after.entries.length };
}

module.exports = {
  SECTION,
  ensureDir,
  readText,
  writeText,
  exists,
  normalize,
  fileFor,
  defaultHeader,
  ensureHeader,
  parseEntries,
  serializeEntries,
  appendEntry,
  replaceEntry,
  removeEntry,
  consolidateFile,
  consolidateFileSimilar,
  listMemoryFiles,
  formatTagLine,
  evictForLimit,
  autoConsolidate,
  jaccardSimilarity,
  extractEntryContent,
};
