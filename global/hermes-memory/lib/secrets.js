'use strict';
const PATTERNS = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /\b(?:sk|pk|rk)_(?:test|live|prod)?_?[A-Za-z0-9_]{16,}\b/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z\-_]{35}\b/,
  /\b(?:xoxb|xoxp|xoxa|xoxs)-[A-Za-z0-9-]{20,}\b/,
  /\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/,
  /(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

function containsSecret(text) {
  const s = String(text || '');
  return PATTERNS.some(r => r.test(s));
}

module.exports = { containsSecret, PATTERNS };
