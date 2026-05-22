# memory-insights

Show what is stored in Claude Hermes Memory.

Read and summarize these files if present:

- `~/.claude/memory/USER.md`
- `~/.claude/memory/MEMORY.md`
- `~/.claude/memory/FAILURES.md`
- `~/.claude/memory/SKILLS.md`
- `~/.claude/memory/PROJECTS.md`

Output sections:

1. User preferences
2. Global memory
3. Failures/corrections
4. Skills/workflows
5. Project notes
6. Possible stale/duplicate items

Do not reveal secrets. If a file contains secrets, warn the user and recommend removal.
