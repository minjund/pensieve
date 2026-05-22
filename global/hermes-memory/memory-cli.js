#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadConfig, CONFIG_PATH, DEFAULTS } = require('./lib/config');
const {
  resolveProjectSlug,
  sanitizeSlug,
  writeActiveProject,
  readActiveProject,
  listProjectSlugs,
  projectDir,
} = require('./lib/scope');
const {
  appendEntry,
  replaceEntry,
  removeEntry,
  consolidateFile,
  listMemoryFiles,
  readText,
  parseEntries,
  SECTION,
} = require('./lib/files');
const {
  searchMemories,
  searchSessions,
  searchExtended,
  getStats,
  deleteMemoryForTarget,
  mirrorMemory,
} = require('./lib/db');
const { indexTranscript } = require('./lib/session-indexer');
const skills = require('./lib/skills');
const { callClaude, parseJsonStrict } = require('./lib/llm');
const { composeContext } = require('./lib/inject');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) { out.flags[key] = true; }
      else { out.flags[key] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}
function logJson(x) { process.stdout.write(JSON.stringify(x, null, 2) + '\n'); }
function fail(msg, code = 1) { process.stderr.write(`${msg}\n`); process.exit(code); }

function targetForScope(target, scope, slug) {
  const cfg = loadConfig();
  if (cfg.globalOnlyTargets.includes(target)) return { scope: 'global', slug: '' };
  if (cfg.projectScopedTargets.includes(target)) {
    if (scope === 'global') return { scope: 'global', slug: '' };
    return { scope: 'project', slug };
  }
  return { scope: scope === 'project' ? 'project' : 'global', slug: scope === 'project' ? slug : '' };
}

function resolveRoute(args, target) {
  const scope = args.flags.scope || 'auto';
  const projectArg = args.flags.project ? sanitizeSlug(args.flags.project) : '';
  const cwd = args.flags.cwd || process.cwd();
  const resolvedSlug = projectArg || resolveProjectSlug(cwd);
  return targetForScope(target, scope === 'auto' ? (resolvedSlug ? 'project' : 'global') : scope, resolvedSlug);
}

// ---- memory CRUD ----

function cmdAdd(args) {
  const target = args._[0];
  const content = args._.slice(1).join(' ');
  if (!target || !content) fail('Usage: memory-cli.js add <TARGET.md> "<content>" [--scope global|project] [--project NAME] [--category C] [--tag T]');
  const route = resolveRoute(args, target);
  const meta = {
    cwd: args.flags.cwd || process.cwd(),
    projectSlug: route.slug,
    source: 'cli:add',
    category: args.flags.category || '',
    tag: args.flags.tag || '',
  };
  const r = appendEntry(target, content, meta);
  if (!r.ok) fail(`add failed: ${r.reason}`);
  logJson({ ok: true, file: r.file, scope: route.scope, project: route.slug, target });
}

function cmdReplace(args) {
  const target = args._[0];
  const query = args._[1];
  const newText = args._.slice(2).join(' ');
  if (!target || !query || !newText) fail('Usage: memory-cli.js replace <TARGET.md> "<query>" "<new text>" [--scope ...] [--project NAME]');
  const route = resolveRoute(args, target);
  const meta = { cwd: args.flags.cwd || process.cwd(), projectSlug: route.slug, source: 'cli:replace', category: args.flags.category || '' };
  const r = replaceEntry(target, query, newText, meta);
  if (!r.ok) fail(`replace failed: ${r.reason}`);
  logJson({ ok: true, file: r.file, target });
}

function cmdRemove(args) {
  const target = args._[0];
  const query = args._.slice(1).join(' ');
  if (!target || !query) fail('Usage: memory-cli.js remove <TARGET.md> "<query>" [--scope ...] [--project NAME]');
  const route = resolveRoute(args, target);
  const r = removeEntry(target, query, { projectSlug: route.slug });
  if (!r.ok) fail(`remove failed: ${r.reason}`);
  logJson({ ok: true, file: r.file, removed: r.removed });
}

function cmdSearch(args) {
  const q = args._.join(' ');
  if (!q) fail('Usage: memory-cli.js search "<query>" [--scope ...] [--project ...] [--target X.md] [--sessions] [--limit N]');
  const limit = parseInt(args.flags.limit, 10) || 20;
  const opts = { limit };
  if (args.flags.scope) opts.scope = args.flags.scope;
  if (args.flags.project) opts.project = sanitizeSlug(args.flags.project);
  if (args.flags.target) opts.target = args.flags.target;
  if (args.flags.role) opts.role = args.flags.role;

  const out = { memories: [], sessions: [] };
  const mem = searchMemories(q, opts);
  if (mem === null) {
    const slug = opts.project || resolveProjectSlug(args.flags.cwd || process.cwd());
    const files = listMemoryFiles(slug);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = [];
    for (const f of files) {
      const text = readText(f.path);
      const parts = text.split(SECTION).slice(1).map(x => x.trim()).filter(Boolean);
      for (const p of parts) {
        const l = p.toLowerCase();
        if (terms.every(t => l.includes(t))) rows.push({ scope: f.scope, target: f.target, snippet: p.slice(0, 500) });
      }
    }
    out.memories = rows.slice(0, limit);
    out.fallback = 'markdown';
  } else {
    out.memories = mem;
  }
  if (args.flags.sessions) {
    const s = searchSessions(q, opts);
    out.sessions = s || [];
  }
  if (args.flags.extended) {
    const e = searchExtended(q, opts);
    out.extended = e || [];
  }
  logJson(out);
}

function cmdInsights(args) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);
  const files = listMemoryFiles(slug);
  const out = { project: slug || null, files: [] };
  for (const f of files) {
    const text = readText(f.path);
    out.files.push({ scope: f.scope, target: f.target, path: f.path, length: text.length, tail: text.slice(-2000) });
  }
  logJson(out);
}

// ---- consolidate (regex + optional LLM) ----

function tokenJaccard(a, b) {
  const t1 = new Set(String(a || '').toLowerCase().split(/\W+/).filter(Boolean));
  const t2 = new Set(String(b || '').toLowerCase().split(/\W+/).filter(Boolean));
  if (!t1.size && !t2.size) return 1;
  let inter = 0;
  for (const x of t1) if (t2.has(x)) inter += 1;
  const uni = t1.size + t2.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function llmMergeGroup(entries, target) {
  const cfg = loadConfig();
  if (!cfg.llmConsolidateEnabled || !cfg.useLlmExtractor) return null;
  const blob = entries.map((e, i) => `[${i}] ${e}`).join('\n---\n');
  const prompt = `Merge these near-duplicate ${target} memory entries into ONE canonical entry that preserves all unique information. Return ONLY JSON: {"merged":"<text>"}. Prefer Korean if source is Korean. No markdown.

Entries:
${blob}`;
  const out = callClaude(prompt, { timeoutMs: cfg.llmTimeoutMs, requireExtractor: true });
  const obj = parseJsonStrict(out);
  if (!obj || typeof obj.merged !== 'string') return null;
  return obj.merged.trim();
}

function consolidateLlm(filePath, target) {
  const cfg = loadConfig();
  const text = readText(filePath);
  if (!text) return { ok: true, kept: 0, merged: 0 };
  const { header, entries } = parseEntries(text);
  if (entries.length < 2) return consolidateFile(filePath);

  // Build similarity groups (greedy, single-pass)
  const groups = [];
  const used = new Set();
  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(j)) continue;
      if (tokenJaccard(entries[i].body, entries[j].body) >= 0.6) {
        group.push(j);
        used.add(j);
      }
    }
    groups.push(group);
  }
  let merged = 0;
  let llmFailures = 0;
  const kept = [];
  for (const idxs of groups) {
    if (idxs.length === 1) { kept.push(entries[idxs[0]]); continue; }
    const bodies = idxs.map(i => entries[i].body);
    const mergedText = llmMergeGroup(bodies, target);
    if (mergedText) {
      kept.push({ raw: mergedText, body: mergedText });
      merged += idxs.length - 1;
    } else {
      // LLM unavailable or failed -> DO NOT drop entries. Keep them all.
      llmFailures += 1;
      for (const i of idxs) kept.push(entries[i]);
    }
  }
  if (kept.length === entries.length && merged === 0) {
    // No-op write; preserve original text to avoid touching mtime needlessly.
    return { ok: true, kept: kept.length, merged: 0, llmFailures, untouched: true };
  }
  const fs2 = require('fs');
  const out = [];
  out.push((header || '').trimEnd());
  for (const e of kept) out.push(`\n${SECTION}\n\n${e.body.trim()}\n`);
  fs2.writeFileSync(filePath, out.join('\n'));
  return { ok: true, kept: kept.length, merged, llmFailures };
}

function cmdConsolidate(args) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);
  const files = listMemoryFiles(slug);
  const useLlm = !!args.flags.llm;
  const report = [];
  for (const f of files) {
    if (args.flags['dry-run']) {
      const text = readText(f.path);
      const seen = new Set(); let dup = 0; let total = 0;
      for (const p of text.split(SECTION).slice(1).map(x => x.trim()).filter(Boolean)) {
        total += 1;
        const key = p.replace(/\s+/g, ' ').toLowerCase().slice(0, 400);
        if (seen.has(key)) dup += 1; else seen.add(key);
      }
      report.push({ file: f.path, total, duplicates: dup, dryRun: true });
    } else if (useLlm) {
      const r = consolidateLlm(f.path, f.target);
      report.push({ file: f.path, kept: r.kept, merged: r.merged, mode: 'llm' });
    } else {
      const r = consolidateFile(f.path);
      report.push({ file: f.path, kept: r.kept, removed: r.removed, mode: 'fifo' });
    }
  }
  logJson({ ok: true, llm: useLlm, report });
}

// ---- project ----

function cmdSwitchProject(args) {
  const name = args._[0];
  if (!name) {
    const cur = readActiveProject() || '(none)';
    const projects = listProjectSlugs();
    logJson({ active: cur, projects });
    return;
  }
  if (name === '--clear' || name === 'clear') {
    writeActiveProject('');
    logJson({ ok: true, cleared: true });
    return;
  }
  const slug = sanitizeSlug(name);
  writeActiveProject(slug);
  projectDir(slug);
  logJson({ ok: true, active: slug });
}

function cmdStats() {
  const stats = getStats();
  const projects = listProjectSlugs();
  logJson({ db: stats, projects, active: readActiveProject() || null, config: CONFIG_PATH });
}

function cmdIndexSessions(args) {
  const input = args._[0];
  if (!input) fail('Usage: memory-cli.js index-sessions <transcript-path-or-dir> [--project NAME]');
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : '';
  const stat = (() => { try { return fs.statSync(input); } catch { return null; } })();
  if (!stat) fail(`path not found: ${input}`);
  const files = stat.isDirectory()
    ? fs.readdirSync(input).filter(n => n.endsWith('.jsonl')).map(n => path.join(input, n))
    : [input];
  const report = [];
  for (const f of files) {
    const sessionId = path.basename(f, path.extname(f));
    const r = indexTranscript({ transcriptPath: f, sessionId, project: slug });
    report.push({ file: f, sessionId, ...r });
  }
  logJson({ ok: true, report });
}

// ---- mode (config writer) ----

function readConfigFile() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return { ...DEFAULTS }; }
}
function writeConfigFile(obj) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2));
}

function cmdMode(args) {
  const cfg = readConfigFile();
  const sub = args._[0];
  if (!sub || sub === 'show') { logJson({ memoryMode: cfg.memoryMode, memoryPolicyStyle: cfg.memoryPolicyStyle, config: cfg }); return; }
  if (sub === 'policy') cfg.memoryMode = 'policy-only';
  else if (sub === 'legacy') cfg.memoryMode = 'legacy-inject';
  else if (sub === 'full' || sub === 'compact' || sub === 'none') cfg.memoryPolicyStyle = sub;
  else if (sub === 'custom') {
    cfg.memoryPolicyStyle = 'custom';
    if (args.flags.text) cfg.customMemoryPolicy = String(args.flags.text);
  } else if (sub === 'set') {
    for (const k of Object.keys(args.flags)) {
      let v = args.flags[k];
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (!isNaN(Number(v)) && v !== '' && v !== true) v = Number(v);
      cfg[k] = v;
    }
  } else {
    fail(`unknown mode subcommand: ${sub}. Use show|policy|legacy|full|compact|none|custom|set`);
  }
  writeConfigFile(cfg);
  logJson({ ok: true, memoryMode: cfg.memoryMode, memoryPolicyStyle: cfg.memoryPolicyStyle });
}

// ---- prune ----

function parseEntryDate(body) {
  const m = /##\s*(\d{4})-(\d{2})-(\d{2})/.exec(body);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(ms);
}

function cmdPrune(args) {
  const cfg = loadConfig();
  const days = parseInt(args.flags['older-than'], 10) || cfg.pruneOlderThanDays;
  const dry = !!args.flags['dry-run'];
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);
  const files = listMemoryFiles(slug);
  const cutoff = Date.now() - days * 86400 * 1000;
  const report = [];
  for (const f of files) {
    const text = readText(f.path);
    const { header, entries } = parseEntries(text);
    const kept = [];
    let pruned = 0;
    for (const e of entries) {
      const dt = parseEntryDate(e.body);
      if (dt && dt.getTime() < cutoff) { pruned += 1; continue; }
      kept.push(e);
    }
    if (!dry && pruned > 0) {
      const out = [];
      out.push((header || '').trimEnd());
      for (const e of kept) out.push(`\n${SECTION}\n\n${e.body.trim()}\n`);
      fs.writeFileSync(f.path, out.join('\n'));
    }
    report.push({ file: f.path, total: entries.length, pruned, kept: kept.length, dryRun: dry });
  }
  logJson({ ok: true, olderThanDays: days, report });
}

// ---- sync-markdown ----

function cmdSyncMarkdown(args) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);
  const files = listMemoryFiles(slug);
  const report = [];
  for (const f of files) {
    const text = readText(f.path);
    const { entries } = parseEntries(text);
    const project = f.scope === 'project' ? (f.slug || slug || '') : '';
    deleteMemoryForTarget({ scope: f.scope, project, target: f.target });
    let inserted = 0;
    for (const e of entries) {
      const m = /^\s*-\s+([\s\S]*?)(?:\n<!--|$)/m.exec(e.body);
      const content = (m && m[1] ? m[1] : e.body).replace(/\s+/g, ' ').trim();
      if (!content) continue;
      const ok = mirrorMemory({ scope: f.scope, project, target: f.target, source: 'cli:sync-markdown', category: '', content });
      if (ok) inserted += 1;
    }
    report.push({ file: f.path, scope: f.scope, target: f.target, project, entries: entries.length, inserted });
  }
  logJson({ ok: true, report });
}

// ---- interview ----

const INTERVIEW_QUESTIONS = [
  { id: 'lang', target: 'USER.md', category: 'preference', prefix: '응답 언어/스타일: ',
    q: 'Q1) 어떤 언어와 응답 스타일을 선호하시나요? (예: 한국어 간결한 스타일)' },
  { id: 'role', target: 'USER.md', category: 'preference', prefix: '역할/소속: ',
    q: 'Q2) 본인의 역할/팀/주요 책임 한 줄로 알려주세요.' },
  { id: 'env', target: 'MEMORY.md', category: 'insight', prefix: '개발 환경: ',
    q: 'Q3) 주요 OS/언어 런타임/패키지매니저 (예: Windows + Node 22 + pnpm)' },
  { id: 'avoid', target: 'FAILURES.md', category: 'correction', prefix: '하지 말 것: ',
    q: 'Q4) Claude가 절대 하지 말아야 할 행동이 있다면?' },
  { id: 'projects', target: 'PROJECTS.md', category: 'insight', prefix: '주요 프로젝트: ',
    q: 'Q5) Claude가 자주 다루는 주요 프로젝트 이름들?' },
  { id: 'past', target: 'FAILURES.md', category: 'failure', prefix: '과거 실패: ',
    q: 'Q6) 기억해 둬야 할 과거 실패/교정 사례가 있다면?' },
  { id: 'style', target: 'USER.md', category: 'preference', prefix: '답변 스타일: ',
    q: 'Q7) 답변 길이/형식 선호? (예: 짧고 단호, 불릿 위주, 완성도 100%)' },
];

async function cmdInterview(args) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);

  // Non-interactive --json mode reads {id:value, ...} from stdin
  if (args.flags.json) {
    const raw = fs.readFileSync(0, 'utf8');
    let answers = {};
    try { answers = JSON.parse(raw); } catch { fail('invalid JSON on stdin'); }
    const saved = [];
    for (const q of INTERVIEW_QUESTIONS) {
      const v = answers[q.id];
      if (!v || String(v).trim().length < 2) continue;
      const isGlobalOnly = q.target === 'USER.md' || q.target === 'PROJECTS.md';
      const r = appendEntry(q.target, `${q.prefix}${String(v).trim()}`, {
        cwd, projectSlug: isGlobalOnly ? '' : slug, source: 'cli:interview', category: q.category
      });
      if (r.ok) saved.push({ id: q.id, target: q.target });
    }
    logJson({ ok: true, saved });
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q + '\n> ', a => res(a)));
  const saved = [];
  process.stdout.write('# Hermes Memory 인터뷰 — 빈 줄로 건너뛰기, Ctrl-C로 종료\n\n');
  for (const q of INTERVIEW_QUESTIONS) {
    let answer = '';
    try { answer = await ask(q.q); } catch { break; }
    const v = String(answer || '').trim();
    if (!v) continue;
    const isGlobalOnly = q.target === 'USER.md' || q.target === 'PROJECTS.md';
    const r = appendEntry(q.target, `${q.prefix}${v}`, {
      cwd, projectSlug: isGlobalOnly ? '' : slug, source: 'cli:interview', category: q.category
    });
    if (r.ok) saved.push({ id: q.id, target: q.target });
  }
  rl.close();
  logJson({ ok: true, saved });
}

// ---- preview-context ----

function cmdPreviewContext(args) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : '';
  const { text, slug: usedSlug } = composeContext(cwd, slug ? { projectSlug: slug } : {});
  if (args.flags.json) {
    logJson({ ok: true, project: usedSlug || null, length: text.length, additionalContext: text });
  } else {
    process.stdout.write(text + '\n');
  }
}

// ---- skills ----

function cmdSkill(args, sub) {
  const cwd = args.flags.cwd || process.cwd();
  const slug = args.flags.project ? sanitizeSlug(args.flags.project) : resolveProjectSlug(cwd);
  const scope = args.flags.scope === 'global' ? 'global' : (args.flags.scope === 'project' ? 'project' : (slug ? 'project' : 'global'));
  switch (sub) {
    case 'list':
    case 'view': {
      if (args._[0]) {
        const r = skills.viewSkill({ scope, project: slug, name: args._[0] });
        if (!r.ok) fail(`view failed: ${r.reason}`);
        logJson(r);
      } else {
        logJson(skills.viewSkill({ scope, project: slug }));
      }
      return;
    }
    case 'create': {
      const name = args._[0];
      if (!name) fail('Usage: skill-create <name> --description "..." [--trigger /x] [--when "..."] [--procedure "..."] [--pitfalls "..."] [--verify "..."] [--allow-conflicts] [--scope ...] [--project NAME]');
      const sections = {
        when_to_use: args.flags.when || '',
        procedure_steps: args.flags.procedure || '',
        pitfalls: args.flags.pitfalls || '',
        verification_steps: args.flags.verify || '',
      };
      const r = skills.createSkill({
        scope, project: slug, name,
        description: args.flags.description || '',
        trigger: args.flags.trigger || '',
        sections,
        allowConflicts: !!args.flags['allow-conflicts'],
      });
      if (!r.ok) fail(`create failed: ${r.reason} ${r.conflicts ? JSON.stringify(r.conflicts) : ''}`);
      logJson(r);
      return;
    }
    case 'patch': {
      const name = args._[0];
      const section = args._[1];
      const content = args._.slice(2).join(' ') || args.flags.content || '';
      if (!name || !section) fail('Usage: skill-patch <name> <when_to_use|procedure_steps|pitfalls|verification_steps> "<content>"');
      const r = skills.patchSkill({ scope, project: slug, name, sectionKey: section, newContent: content });
      if (!r.ok) fail(`patch failed: ${r.reason}`);
      logJson(r);
      return;
    }
    case 'update': {
      const name = args._[0];
      if (!name) fail('Usage: skill-update <name> [--description "..."] [--body "..."]');
      const r = skills.updateSkill({ scope, project: slug, name, description: args.flags.description, body: args.flags.body });
      if (!r.ok) fail(`update failed: ${r.reason}`);
      logJson(r);
      return;
    }
    case 'delete': {
      const name = args._[0];
      if (!name) fail('Usage: skill-delete <name> [--scope ...] [--project NAME]');
      const r = skills.deleteSkill({ scope, project: slug, name });
      if (!r.ok) fail(`delete failed: ${r.reason}`);
      logJson(r);
      return;
    }
    default:
      fail(`unknown skill subcommand: ${sub}`);
  }
}

// ---- help ----

function help() {
  process.stdout.write(`memory-cli.js subcommands:
  add      <TARGET.md> "<content>"        [--scope global|project] [--project NAME] [--category C] [--tag T]
  replace  <TARGET.md> "<query>" "<new>"  [--scope ...] [--project NAME]
  remove   <TARGET.md> "<query>"          [--scope ...] [--project NAME]
  search   "<query>"                      [--scope ...] [--project NAME] [--target X.md] [--sessions] [--extended] [--limit N] [--role ...]
  insights                                [--project NAME]
  preview-context                         [--project NAME] [--json]
  consolidate                             [--project NAME] [--dry-run] [--llm]
  switch-project [<name>|clear]
  index-sessions <path-or-dir>            [--project NAME]
  sync-markdown                           [--project NAME]
  stats
  mode  show | policy | legacy | full | compact | none | custom --text "..." | set --KEY VAL
  prune                                   [--older-than DAYS] [--dry-run] [--project NAME]
  interview                               [--json (stdin)]
  skill-create  <name> --description "..." [--trigger /x] [--when "..."] [--procedure "..."] [--pitfalls "..."] [--verify "..."] [--allow-conflicts] [--scope ...]
  skill-view    [<name>]                  [--scope ...] [--project NAME]
  skill-patch   <name> <section> "<content>"
  skill-update  <name> [--description "..."] [--body "..."]
  skill-delete  <name>                    [--scope ...] [--project NAME]
`);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'add': return cmdAdd(args);
    case 'replace': return cmdReplace(args);
    case 'remove': return cmdRemove(args);
    case 'search': return cmdSearch(args);
    case 'insights': return cmdInsights(args);
    case 'consolidate': return cmdConsolidate(args);
    case 'switch-project': return cmdSwitchProject(args);
    case 'index-sessions': return cmdIndexSessions(args);
    case 'sync-markdown': return cmdSyncMarkdown(args);
    case 'stats': return cmdStats();
    case 'mode': return cmdMode(args);
    case 'prune': return cmdPrune(args);
    case 'interview': return cmdInterview(args);
    case 'preview-context': return cmdPreviewContext(args);
    case 'skill-create': return cmdSkill(args, 'create');
    case 'skill-view': return cmdSkill(args, 'view');
    case 'skill-list': return cmdSkill(args, 'list');
    case 'skill-patch': return cmdSkill(args, 'patch');
    case 'skill-update': return cmdSkill(args, 'update');
    case 'skill-delete': return cmdSkill(args, 'delete');
    case 'help':
    default: return help();
  }
}

Promise.resolve()
  .then(() => main())
  .catch(e => { process.stderr.write(`error: ${e && e.message ? e.message : String(e)}\n`); process.exit(2); });
