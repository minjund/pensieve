# memory-search

Search Claude Hermes Memory.

Use the local CLI if tools are available:

```powershell
node ~/.claude/hermes-memory/memory-cli.js search "검색어"
```

If the SQLite dependency `better-sqlite3` is installed, this searches `~/.claude/memory/sessions.db` using SQLite FTS5. If not, it falls back to Markdown text search.

Summarize the results and explain which memory file each result came from.
