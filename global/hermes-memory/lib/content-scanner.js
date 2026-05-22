'use strict';
// Detects prompt-injection style content that should never be persisted into memory.
// Returns true if the input looks like an attempt to override system instructions
// or inject role/system markers that downstream models might honor.
//
// This is best-effort scanning, not a security boundary. Treat output of
// containsInjection() as an additional filter alongside containsSecret().

const PATTERNS = [
  // English instruction-override phrasing
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)\b/i,
  /\b(?:forget|override|bypass)\s+(?:everything|all|previous|prior|system)\b/i,
  /\byou\s+are\s+now\s+(?:a|an|the)\s+(?:new|different|unrestricted)/i,
  /\bnew\s+system\s+(?:prompt|instructions?)\b/i,
  /\bact\s+as\s+(?:a|an)\s+(?:dan|jailbroken|unrestricted|evil)/i,
  /\benable\s+(?:dev|developer|admin|root|god)\s+mode\b/i,
  /\bdeveloper\s+mode\s+(?:enabled|on|activated)\b/i,
  // Role/system tag injection markers used to break chat templates
  /<\|(?:im_start|im_end|system|assistant|user|endoftext)\|>/i,
  /\[\/?INST\]/,
  /<\/?(?:system|assistant|user)>/i,
  // Korean instruction-override phrasing
  /(?:이전|위의)\s*(?:지침|명령|규칙)(?:을|는|를)?\s*(?:무시|잊어|버려|덮어)/,
  /시스템\s*프롬프트(?:를|은|는)?\s*(?:무시|덮어|초기화|재설정)/,
  /너는\s*이제\s*(?:DAN|새로운|제한없는|탈옥)/i,
  // Output exfiltration phrasing
  /\b(?:reveal|print|display|show)\s+(?:the|your)?\s*(?:system|hidden)\s+prompt\b/i,
  /\bprint\s+all\s+your\s+(?:instructions|rules|prompts)\b/i,
];

function containsInjection(text) {
  const s = String(text || '');
  if (!s) return false;
  return PATTERNS.some(r => r.test(s));
}

function scanReason(text) {
  const s = String(text || '');
  for (const r of PATTERNS) {
    if (r.test(s)) return r.source;
  }
  return null;
}

module.exports = { containsInjection, scanReason, PATTERNS };
