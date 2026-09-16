---
name: memory-clean-noise
description: Remove noise entries from Hermes memory (LLM extraction prompts, slash command definitions, system-tag blocks captured as user messages). Args - optional --dry-run, --silent, --project NAME.
---

# memory-clean-noise

```powershell
# Preview what would be removed (recommended first run)
node ~/.claude/hermes-memory/memory-cli.js clean-noise --dry-run

# Actually remove noise from active project + global
node ~/.claude/hermes-memory/memory-cli.js clean-noise

# Silent mode (minimal output) for scripts
node ~/.claude/hermes-memory/memory-cli.js clean-noise --silent

# Target a specific project
node ~/.claude/hermes-memory/memory-cli.js clean-noise --project my-project
```

Detected noise patterns:
- LLM extraction prompts captured as memory ("Extract durable memory candidates...", "Return ONLY JSON array")
- Slash command definitions (`# memory-add`, "Append a memory entry into...", "Run via CLI:")
- System tag blocks (`<system-reminder>`, `<local-command-caveat>`, `<memory-policy>`, `<memory-context>`, `<command-name>`)
- Wrapped slash command entries (`Failure: # memory-...`, `Correction: <local-command-caveat>`)

Removed entries are logged to `~/.claude/hermes-memory/state/cleanup-log.jsonl` for audit.

`autoCleanNoise` runs automatically on Stop / SubagentStop / PreCompact and after background-review (set to false in `~/.claude/hermes-memory-config.json` to disable).
