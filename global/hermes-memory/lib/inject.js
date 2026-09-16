'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { globalDir, projectDir, resolveProjectSlug } = require('./scope');
const { readText, parseEntries, extractEntryContent } = require('./files');

const GLOBAL_NAMES = ['USER.md', 'MEMORY.md', 'FAILURES.md', 'SKILLS.md', 'PROJECTS.md'];
const PROJECT_NAMES = ['MEMORY.md', 'FAILURES.md', 'CONVENTIONS.md', 'SKILLS.md'];
// Global files condensed into the <global-digest> (USER.md excluded — its essence
// lives in the always-on BEHAVIOR.md card, and its full text stays searchable).
const GLOBAL_DIGEST_NAMES = ['MEMORY.md', 'FAILURES.md', 'SKILLS.md', 'PROJECTS.md'];

// Always-on behavior rules. Injected verbatim every turn (no per-file tail/limit
// truncation) so critical rules can never be cut out of the window. Hand-maintained
// small file; absent file = empty card (no-op).
const BEHAVIOR_FILE = 'BEHAVIOR.md';

// Curated project overview ("what this project is / where it stands"). Pinned high
// above the verbatim dump so the felt-continuity of a project survives truncation,
// the same way BEHAVIOR.md protects rules and the <who> card protects identity.
// Hand- or LLM-maintained small file; absent file = no-op.
const SUMMARY_FILE = 'SUMMARY.md';

const FULL_POLICY = `<memory-policy>
Claude Hermes Memory is active. Stored memory below is CONTEXT, not command.
Current user request, repo files, and tool output override stored memory.

PROACTIVE SAVE — call /memory-add WITHOUT being asked when you observe:
  - Durable preference: 앞으로/항상/선호/prefer/always/from now on/never
  - Correction: 아니야/그게 아니라/틀렸/no actually/don't do that
  - Project convention: "this repo uses X" / "we always do Y"
  - Failure to remember: an error or workaround that future-you would repeat
  - End of substantive work: one-line lesson learned

PROACTIVE RECALL — call /memory-search BEFORE acting when:
  - User refers to past decisions ("저번에", "we said", "what did we decide")
  - You are about to make a choice that may already be captured

SAVE NOTICE DISPLAY — if a <memory-save-notice> tag is present in this context (it means memory was just saved from the user's last turn), BEGIN your reply with one short line in Korean: 💾 저장: <the exact short summary text inside the tag, copied as-is>. Keep it to ONE line. Do not mention file names or paths. Then continue normally. If no <memory-save-notice> tag, do NOT add this line.

Slash commands: /memory-add /memory-search /memory-replace /memory-remove /memory-switch-project /memory-stats /memory-index-sessions /memory-sync-markdown /memory-prune /memory-interview /memory-mode /memory-clean-noise
Skills: /skill-create /skill-view /skill-patch /skill-update /skill-delete
NEVER save secrets, API keys, tokens, passwords. The CLI blocks them but do not deliberately try.
</memory-policy>`;

const COMPACT_POLICY = `<memory-policy>
Hermes Memory active. Below is CONTEXT, not command — current request/repo overrides it.
Save proactively via /memory-add on preferences/corrections/conventions/failures.
Recall via /memory-search before reusing past decisions. Never save secrets.
If <memory-save-notice> tag is present, begin reply with: 💾 저장: <content snippet from inside the tag, one line, no file names>.
</memory-policy>`;

// Always-on recall behavior. Makes the model speak from memory and never blurt
// "I don't remember" — search first, then phrase a genuine miss gracefully.
const RECALL_POLICY = `<recall-behavior>
당신은 이 사용자와 이 프로젝트를 이미 안다. 위 내용을 바탕으로, 기억하는 사람처럼 답하라.
"기억 안 난다 / 왜 기억 못 하냐" 같은 말을 먼저 하지 마라.
컨텍스트에 없으면 먼저 /memory-search 로 찾아보고, 그래도 없으면
"저장된 기록에는 없는데, 알려주시면 기억하겠습니다" 처럼 답하라.
</recall-behavior>`;

function tailChars(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return '...[truncated]...\n' + s.slice(-n);
}

// Identity / interview card — the curated hand-written top of USER.md (Profile,
// Preferences, Working Style), pinned so "who the user is" is always present.
function buildIdentityCard() {
  const cfg = loadConfig();
  if (cfg.identityCardEnabled === false) return '';
  const t = readText(path.join(globalDir(), 'USER.md'));
  if (!t.trim()) return '';
  const { header } = parseEntries(t);
  let body = (header || '').trim();
  body = body.replace(/^#\s+.*$/m, '').trim();              // drop the "# User Memory" title
  body = body.replace(/##\s*Do Not Store[\s\S]*$/i, '').trim(); // drop secrets warning
  if (!body) return '';
  const limit = typeof cfg.identityCardCharLimit === 'number' ? cfg.identityCardCharLimit : 1200;
  if (body.length > limit) body = body.slice(0, limit) + '\n...[truncated]...';
  return `<who>\n사용자에 대해 당신이 아는 것 (인터뷰):\n${body}\n</who>`;
}

// Deterministic auto-recall: FTS-search the current prompt and inject the most
// relevant saved entries verbatim, so "it's saved but not in the snapshot" never
// turns into "I don't remember". FTS is sub-ms, safe in the synchronous hook.
function buildAutoRecall(promptText, slug) {
  const cfg = loadConfig();
  if (cfg.autoRecallEnabled === false) return '';
  const text = String(promptText || '').trim();
  if (text.length < 4) return '';
  const max = cfg.autoRecallMaxResults || 6;
  let rows = [];
  try {
    const { recallMemories } = require('./db');
    rows = recallMemories(text, { limit: max }) || [];
  } catch { rows = []; }
  if (!rows.length) return '';
  const seen = new Set();
  const lines = [];
  for (const r of rows) {
    const c = String(r.content || '').replace(/\s+/g, ' ').trim();
    if (!c || c.length < 8) continue;
    const key = c.toLowerCase().slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const scope = r.project ? `project:${r.project}` : (r.scope || 'global');
    lines.push(`- [${scope}/${r.target}] ${c}`);
    if (lines.length >= max) break;
  }
  if (!lines.length) return '';
  let body = lines.join('\n');
  const limit = cfg.autoRecallCharLimit || 1500;
  if (body.length > limit) body = body.slice(0, limit) + '\n...[더 보기: /memory-search]...';
  return `<recalled-memory>\n현재 질문과 관련해 저장된 기억 (자동 검색):\n${body}\n</recalled-memory>`;
}

function policyBlock() {
  const cfg = loadConfig();
  switch (cfg.memoryPolicyStyle) {
    case 'none': return '';
    case 'compact': return COMPACT_POLICY;
    case 'custom': return (cfg.customMemoryPolicy || '').trim();
    case 'full':
    default: return FULL_POLICY;
  }
}

// First ISO date found in an entry body (## YYYY-MM-DD header or date= meta).
// Empty string when undated — those sort last (treated as oldest).
function entryDate(body) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(body || '');
  return m ? m[1] : '';
}

// Entry-level newest-first merge across all target files. Instead of giving each
// file a fixed tail slice (so an old entry in one file can crowd out a fresh entry
// in another), we pool every entry, sort by date descending, and fill up to
// injectCharLimit from the newest down. Overflow/older entries stay searchable via
// /memory-search. Array.sort is stable (Node), so same-date entries keep insertion
// order: files are pushed in list order, each file newest-entry-first.
function buildMergedDump(cfg, slug, opts) {
  const wantGlobal = !opts.scopes || opts.scopes.global !== false;
  const wantProject = !opts.scopes || opts.scopes.project !== false;
  const collected = [];
  const pushFrom = (dir, names, prefix) => {
    for (const name of names) {
      const t = readText(path.join(dir, name)).trim();
      if (!t) continue;
      const stem = name.replace(/\.md$/i, '');
      const { entries } = parseEntries(t);
      for (let i = entries.length - 1; i >= 0; i--) {
        const c = extractEntryContent(entries[i].body);
        if (!c || c.length < 4) continue;
        collected.push({ date: entryDate(entries[i].body), label: `${prefix}${stem}`, content: c });
      }
    }
  };
  if (wantGlobal) pushFrom(globalDir(), GLOBAL_NAMES, 'g:');
  if (wantProject && slug) pushFrom(projectDir(slug), PROJECT_NAMES, '');
  if (!collected.length) return '';

  collected.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const seen = new Set();
  const lines = [];
  let size = 0;
  let dropped = 0;
  for (const e of collected) {
    const key = e.content.replace(/\s+/g, ' ').toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;          // dedupe repeated facts across/within files
    seen.add(key);
    const line = `- [${e.date ? e.date + ' ' : ''}${e.label}] ${e.content}`;
    if (size + line.length + 1 > cfg.injectCharLimit) { dropped++; continue; }
    lines.push(line);
    size += line.length + 1;
  }
  let body = lines.join('\n');
  if (dropped > 0) body += `\n...[+${dropped} older entries — use /memory-search]...`;
  return body;
}

function buildMemoryBlock(cwd, opts = {}) {
  const cfg = loadConfig();
  const slug = opts.projectSlug || resolveProjectSlug(cwd, opts.override);

  // Default: entry-level newest-first merge (freshest knowledge wins the space).
  if (cfg.dumpMergeByDate !== false) {
    return { text: buildMergedDump(cfg, slug, opts), slug };
  }

  // Legacy: per-file tail slices with coarse middle-truncation.
  const wantGlobal = !opts.scopes || opts.scopes.global !== false;
  const wantProject = !opts.scopes || opts.scopes.project !== false;
  const sections = [];
  const gdir = globalDir();
  if (wantGlobal) {
    for (const name of GLOBAL_NAMES) {
      const p = path.join(gdir, name);
      const t = readText(p).trim();
      if (t) sections.push(`## global/${name}\n${tailChars(t, 2500)}`);
    }
  }
  if (wantProject && slug) {
    const pdir = projectDir(slug);
    for (const name of PROJECT_NAMES) {
      const p = path.join(pdir, name);
      const t = readText(p).trim();
      if (t) sections.push(`## project[${slug}]/${name}\n${tailChars(t, 2500)}`);
    }
  }
  let joined = sections.join('\n\n---\n\n');
  if (joined.length > cfg.injectCharLimit) {
    joined = joined.slice(0, Math.floor(cfg.injectCharLimit / 4)) +
      '\n\n...[memory truncated]...\n\n' +
      joined.slice(-Math.floor((cfg.injectCharLimit * 3) / 4));
  }
  return { text: joined, slug };
}

function buildBehaviorCard(slug) {
  const cfg = loadConfig();
  if (cfg.behaviorCardEnabled === false) return '';
  const blocks = [];
  const g = readText(path.join(globalDir(), BEHAVIOR_FILE)).trim();
  if (g) blocks.push(`<global>\n${g}\n</global>`);
  if (slug) {
    const p = readText(path.join(projectDir(slug), BEHAVIOR_FILE)).trim();
    if (p) blocks.push(`<project name="${slug}">\n${p}\n</project>`);
  }
  if (!blocks.length) return '';
  let body = blocks.join('\n');
  const limit = typeof cfg.behaviorCardCharLimit === 'number' ? cfg.behaviorCardCharLimit : 2000;
  if (body.length > limit) body = body.slice(0, limit) + '\n...[behavior-rules truncated]...';
  return `<behavior-rules>\nAlways-on rules. Highest priority among stored memory. Follow unless the current request explicitly overrides.\n${body}\n</behavior-rules>`;
}

// Project summary card — curated overview pinned above the dump. Mirrors the
// behavior card shape (global + project blocks) but carries "where this project
// stands", which is the single highest-signal thing a fresh chat needs and the
// part most at risk of being truncated when it lives only in the verbatim dump.
function buildSummaryCard(slug) {
  const cfg = loadConfig();
  if (cfg.summaryCardEnabled === false) return '';
  const blocks = [];
  const g = readText(path.join(globalDir(), SUMMARY_FILE)).trim();
  if (g) blocks.push(`<global>\n${g}\n</global>`);
  if (slug) {
    const p = readText(path.join(projectDir(slug), SUMMARY_FILE)).trim();
    if (p) blocks.push(`<project name="${slug}">\n${p}\n</project>`);
  }
  if (!blocks.length) return '';
  let body = blocks.join('\n');
  const limit = typeof cfg.summaryCardCharLimit === 'number' ? cfg.summaryCardCharLimit : 800;
  if (body.length > limit) body = body.slice(0, limit) + '\n...[summary truncated]...';
  return `<project-summary>\nCurated project state — what this project is and where it stands. Pinned; survives dump truncation.\n${body}\n</project-summary>`;
}

// Continuity card — the most recent saved entries for the active project, so a
// brand-new chat opens "mid-thread" instead of cold. Deterministic (no LLM): on
// SessionStart there is no prompt yet, so auto-recall cannot fire — this is the
// only thing carrying "where we left off" into the very first screen, and it sits
// ABOVE the verbatim dump so it is never the first thing truncated.
function buildContinuity(slug) {
  const cfg = loadConfig();
  if (cfg.continuityEnabled === false) return '';
  if (!slug) return '';
  const max = typeof cfg.continuityMaxEntries === 'number' ? cfg.continuityMaxEntries : 2;
  // MEMORY.md carries the work thread ("what we did / decided"), so it leads;
  // FAILURES.md only tops up the remainder. Failures alone aren't "where we left off".
  const recentFrom = (name, n) => {
    if (n <= 0) return [];
    const t = readText(path.join(projectDir(slug), name)).trim();
    if (!t) return [];
    const { entries } = parseEntries(t);
    const out = [];
    for (const e of entries.slice(-n)) {
      const dm = /(\d{4}-\d{2}-\d{2})/.exec(e.body);
      const c = extractEntryContent(e.body);
      if (c && c.length >= 8) out.push({ date: dm ? dm[1] : '', c });
    }
    return out;
  };
  let picked = recentFrom('MEMORY.md', max).slice(-max);
  if (picked.length < max) picked = picked.concat(recentFrom('FAILURES.md', max - picked.length));
  if (!picked.length) return '';
  const lines = picked.map(i => `- ${i.date ? `[${i.date}] ` : ''}${i.c}`);
  let body = lines.join('\n');
  const limit = typeof cfg.continuityCharLimit === 'number' ? cfg.continuityCharLimit : 500;
  if (body.length > limit) body = body.slice(0, limit) + '...';
  return `<continuity>\n지난 작업 맥락 (가장 최근 저장된 기억):\n${body}\n</continuity>`;
}

// Cheap, deterministic condensation of global cross-project memory: most recent
// entries per file, metadata stripped, deduped, capped. Synchronous-safe (no LLM),
// always fresh (no cache). Used in 'project' mode so global knowledge rides along
// in compact form while the full project memory is injected verbatim.
function buildGlobalDigest(limit) {
  const gdir = globalDir();
  const collected = [];
  for (const name of GLOBAL_DIGEST_NAMES) {
    const t = readText(path.join(gdir, name)).trim();
    if (!t) continue;
    const { entries } = parseEntries(t);
    for (const e of entries.slice(-6)) {
      const c = extractEntryContent(e.body);
      if (c && c.length >= 8) collected.push({ tag: name.replace(/\.md$/i, ''), c });
    }
  }
  if (!collected.length) return '';
  const seen = new Set();
  const lines = [];
  for (let i = collected.length - 1; i >= 0; i--) {
    const key = collected[i].c.replace(/\s+/g, ' ').toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.unshift(`- [${collected[i].tag}] ${collected[i].c}`);
  }
  let body = lines.join('\n');
  if (body.length > limit) body = body.slice(0, limit) + '\n...[global-digest truncated — use /memory-search]...';
  return body;
}

// memoryMode → which scopes get the full verbatim dump.
function dumpScopesFor(mode) {
  switch (mode) {
    case 'policy-only': return null;                          // no dump
    case 'project': return { global: false, project: true };  // project only (default)
    default: return { global: true, project: true };          // inject / legacy-inject / other
  }
}

// Layers (see docs/MEMORY-INJECTION-DESIGN.md):
//   Always (every call): policy, active-project, identity(who), behavior card,
//                        recall-behavior, auto-recall(prompt).
//   Heavy only (!opts.light): global-digest + full project/global dump.
// SessionStart → heavy (the persisting snapshot). UserPromptSubmit → light + auto-recall.
// Whole output is capped under the 10K hook-output hard limit (snapshotCharLimit).
function composeContext(cwd, opts = {}) {
  const cfg = loadConfig();
  const slug = opts.projectSlug || resolveProjectSlug(cwd, opts.override);
  const mode = cfg.memoryMode || 'project';
  const light = !!opts.light;
  const parts = [];

  // Policy prompt — omitted only in legacy-inject mode.
  if (mode !== 'legacy-inject') {
    const policy = policyBlock();
    if (policy) parts.push(policy);
  }
  if (slug) parts.push(`<memory-active-project>${slug}</memory-active-project>`);
  if (opts.saveNotice) parts.push(opts.saveNotice);

  // Identity / interview — always (who the user is).
  const identity = buildIdentityCard();
  if (identity) parts.push(identity);

  // Behavior card — always (never truncated by the dump caps).
  const card = buildBehaviorCard(slug);
  if (card) parts.push(card);

  // Project summary — always. Curated "where this project stands", pinned above
  // the verbatim dump so project continuity survives the snapshot char cap.
  const summary = buildSummaryCard(slug);
  if (summary) parts.push(summary);

  // Continuity — always. Most recent saved context so a fresh chat opens
  // mid-thread; the only continuity source on SessionStart (no prompt → no recall).
  const continuity = buildContinuity(slug);
  if (continuity) parts.push(continuity);

  // Recall behavior — always (speak from memory, never "I don't remember").
  parts.push(RECALL_POLICY);

  // Auto-recall — when a prompt is supplied (UserPromptSubmit): inject memory
  // relevant to THIS question so a saved fact is never missed.
  if (opts.prompt) {
    const recalled = buildAutoRecall(opts.prompt, slug);
    if (recalled) parts.push(recalled);
  }

  if (!light) {
    // Global digest — only in 'project' mode.
    if (mode === 'project' && cfg.globalDigestEnabled !== false) {
      const dig = buildGlobalDigest(typeof cfg.globalDigestCharLimit === 'number' ? cfg.globalDigestCharLimit : 1500);
      if (dig) parts.push(`<global-digest>\nCondensed global cross-project memory (highlights). Full global memory: /memory-search.\n${dig}\n</global-digest>`);
    }
    // Verbatim memory dump — scope depends on mode (skipped entirely in policy-only).
    const scopes = dumpScopesFor(mode);
    if (scopes) {
      const { text: memText } = buildMemoryBlock(cwd, { ...opts, projectSlug: slug, scopes });
      if (memText) parts.push(`<memory-context>\n${memText}\n</memory-context>`);
    }
  }

  // Hard cap: stay under Claude Code's 10,000-char hook-output limit. The dump is
  // last, so a trim trades the least-critical content first.
  let text = parts.join('\n');
  const cap = typeof cfg.snapshotCharLimit === 'number' ? cfg.snapshotCharLimit : 9500;
  if (text.length > cap) text = text.slice(0, cap) + '\n...[truncated — use /memory-search for the rest]...';
  return { text, slug };
}

module.exports = { buildMemoryBlock, buildMergedDump, buildBehaviorCard, buildSummaryCard, buildContinuity, buildGlobalDigest, buildIdentityCard, buildAutoRecall, composeContext, RECALL_POLICY, FULL_POLICY, COMPACT_POLICY, GLOBAL_NAMES, PROJECT_NAMES, GLOBAL_DIGEST_NAMES, BEHAVIOR_FILE, SUMMARY_FILE };
