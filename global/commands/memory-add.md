---
name: memory-add
description: Append a durable memory entry. Args - "<TARGET.md> <content>" with optional --scope global|project / --project NAME / --category / --tag.
---

# memory-add

Append a memory entry into Claude Hermes Memory.

Run via CLI:

```powershell
node ~/.claude/hermes-memory/memory-cli.js add USER.md "사용자는 짧은 답변을 선호한다" --category preference
node ~/.claude/hermes-memory/memory-cli.js add MEMORY.md "이 레포는 FTS5 + better-sqlite3 사용" --scope project --category convention
```

Targets:

- `USER.md` — always global (user-level preferences)
- `MEMORY.md`, `FAILURES.md`, `CONVENTIONS.md`, `SKILLS.md` — project-scoped by default (use `--scope global` to force global)
- `PROJECTS.md` — global index of project notes

Rules:

- Never include secrets, API keys, tokens. The CLI blocks them.
- Keep entries short and durable (preferences, conventions, lessons), not transient task state.
- After a successful save, also mirror to the SQLite FTS index automatically.
