---
name: memory-remove
description: Remove a memory entry matching a query substring. Args - "<TARGET.md> <query>".
---

# memory-remove

Delete the first matching entry from a memory file.

```powershell
node ~/.claude/hermes-memory/memory-cli.js remove MEMORY.md "오래된 결정"
node ~/.claude/hermes-memory/memory-cli.js remove FAILURES.md "더 이상 유효하지 않은 실패" --scope project
```

Tip: pair with `/memory-search` to find exact text before removal.
