'use strict';
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./paths');
const {
  parseEntries,
  serializeEntries,
  defaultHeader,
  extractEntryContent,
  listMemoryFiles,
  readText,
} = require('./files');

// Noise signatures: regex + reason label.
// Any match on the entry body (or extracted content) classifies the entry as noise.
const PATTERNS = [
  // LLM extraction prompts that got captured as memory
  { reason: 'llm-extraction-prompt', re: /Extract durable memory candidates from this/i },
  { reason: 'llm-extraction-prompt', re: /Return ONLY JSON array/i },
  { reason: 'llm-extraction-prompt', re: /Background memory review\. Extract DURABLE memory/i },
  { reason: 'llm-extraction-schema', re: /Schema:\s*\[\{"target"\s*:\s*"USER\.md/ },
  // Slash command definition headers + bodies
  { reason: 'slash-command-definition', re: /(?:^|\s)#\s+(?:memory-|wcc:|claude-|sb-|win-|gsd-|skill-)/m },
  { reason: 'slash-command-definition', re: /Append a memory entry into Claude Hermes Memory/ },
  { reason: 'slash-command-definition', re: /Run via CLI:\s*```/ },
  { reason: 'slash-command-definition', re: /Show what is stored in Claude Hermes Memory/ },
  // System tags that got captured as user message content
  { reason: 'system-tag-block', re: /<system-reminder>/ },
  { reason: 'system-tag-block', re: /<local-command-caveat>/ },
  { reason: 'system-tag-block', re: /<memory-policy>/ },
  { reason: 'system-tag-block', re: /<memory-context>/ },
  { reason: 'system-tag-block', re: /<command-name>\s*\/[a-z-]+/ },
  { reason: 'system-tag-block', re: /<command-message>/ },
  // Classifier false positives — "Failure:" / "Correction:" entries that wrap a slash command definition
  { reason: 'wrapped-slash-command', re: /(?:^|\s)(?:Failure|Correction):\s*(?:#\s+(?:memory-|wcc:|claude-|sb-|win-|gsd-|skill-)|Extract durable memory)/im },
  { reason: 'wrapped-slash-command', re: /(?:^|\s)(?:Failure|Correction):\s*<(?:local-command-caveat|system-reminder|memory-policy)>/im },
];

function classifyEntry(body) {
  const reasons = [];
  if (!body || typeof body !== 'string') return reasons;
  for (const p of PATTERNS) {
    if (p.re.test(body)) {
      if (!reasons.includes(p.reason)) reasons.push(p.reason);
    }
  }
  return reasons;
}

function appendLog(records) {
  if (!records.length) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const logPath = path.join(STATE_DIR, 'cleanup-log.jsonl');
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(logPath, lines, 'utf8');
  } catch {}
}

function cleanFile(filePath, opts = {}) {
  const text = readText(filePath);
  if (!text) return { ok: true, file: filePath, removed: 0, kept: 0, removedEntries: [] };
  const parsed = parseEntries(text);
  if (!parsed.entries.length) return { ok: true, file: filePath, removed: 0, kept: 0, removedEntries: [] };

  const kept = [];
  const removedEntries = [];
  for (const e of parsed.entries) {
    const reasons = classifyEntry(e.body);
    if (reasons.length) {
      removedEntries.push({
        body: e.body,
        content: extractEntryContent(e.body).slice(0, 400),
        reasons,
      });
    } else {
      kept.push(e);
    }
  }

  if (!opts.dryRun && removedEntries.length) {
    const out = serializeEntries(parsed.header || defaultHeader(path.basename(filePath)), kept);
    fs.writeFileSync(filePath, out, 'utf8');
  }

  return {
    ok: true,
    file: filePath,
    removed: removedEntries.length,
    kept: kept.length,
    removedEntries,
  };
}

function cleanAll({ slug = '', dryRun = false, silent = false } = {}) {
  const files = listMemoryFiles(slug);
  const reports = [];
  const logRecords = [];
  const ts = new Date().toISOString();
  for (const f of files) {
    const r = cleanFile(f.path, { dryRun });
    reports.push({
      file: f.path,
      scope: f.scope,
      target: f.target,
      removed: r.removed,
      kept: r.kept,
      reasons: r.removedEntries.flatMap(e => e.reasons),
    });
    if (!dryRun) {
      for (const ent of r.removedEntries) {
        logRecords.push({
          ts,
          file: f.path,
          scope: f.scope,
          target: f.target,
          reasons: ent.reasons,
          content: ent.content,
        });
      }
    }
  }
  if (!dryRun) appendLog(logRecords);
  const totalRemoved = reports.reduce((a, b) => a + b.removed, 0);
  return { ok: true, dryRun, slug: slug || null, totalRemoved, reports, silent };
}

module.exports = {
  PATTERNS,
  classifyEntry,
  cleanFile,
  cleanAll,
};
