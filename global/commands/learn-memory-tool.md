# learn-memory-tool

Explain how Claude Hermes Memory works in this installation.

Cover:

- Global memory path: `~/.claude/memory/`
- Global instruction path: `~/.claude/CLAUDE.md`
- Hook path: `~/.claude/hermes-memory/hooks/memory-hook.js`
- Commands path: `~/.claude/commands/`
- Skills path: `~/.claude/skills/`

Explain that this is a Claude Code hook-based memory system, independent of Pi.

Mention limitations:

- Markdown-first storage
- Heuristic automatic capture unless an LLM-based extractor is added
- No SQLite required
- Secret scanning is regex-based, not perfect
