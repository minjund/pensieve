# memory-interview

Interview the user to populate Claude Hermes Memory.

Ask concise questions in Korean unless the user prefers another language:

1. Preferred language and answer style
2. Role/team/context
3. Tools and OS
4. Coding/package-manager preferences
5. Things the assistant must not do
6. Projects that should have persistent notes
7. Any past failures/corrections to remember

After the user answers, update:

- `~/.claude/memory/USER.md` for preferences/profile
- `~/.claude/memory/MEMORY.md` for durable global facts
- `~/.claude/memory/FAILURES.md` for corrections/failures
- `~/.claude/memory/PROJECTS.md` for project-specific notes

Never store secrets, tokens, passwords, or API keys.
