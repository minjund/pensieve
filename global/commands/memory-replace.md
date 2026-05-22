---
name: memory-replace
description: Replace a memory entry matching a query substring. Args - "<TARGET.md> <query> <new text>".
---

# memory-replace

Update an existing memory entry by substring match. The first matching entry in the file is replaced.

```powershell
node ~/.claude/hermes-memory/memory-cli.js replace USER.md "짧은 답변" "사용자는 간결한 한국어 답변을 선호한다"
node ~/.claude/hermes-memory/memory-cli.js replace MEMORY.md "FTS5" "이 레포는 FTS5 + better-sqlite3 + WAL 모드 사용" --scope project
```

If no entry matches, the command fails with `not-found` — use `/memory-search` first to confirm the exact wording.
