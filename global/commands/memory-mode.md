---
name: memory-mode
description: Show or change memory injection mode and policy style. Args - show | policy | legacy | full | compact | none | custom --text "..." | set --KEY VAL.
---

# memory-mode

```powershell
# Show current
node ~/.claude/hermes-memory/memory-cli.js mode show

# Modes
node ~/.claude/hermes-memory/memory-cli.js mode policy   # default: emit policy + memory-context
node ~/.claude/hermes-memory/memory-cli.js mode legacy   # only memory-context, no policy block

# Policy styles
node ~/.claude/hermes-memory/memory-cli.js mode full     # verbose policy (default)
node ~/.claude/hermes-memory/memory-cli.js mode compact  # 3-line policy
node ~/.claude/hermes-memory/memory-cli.js mode none     # no policy block at all
node ~/.claude/hermes-memory/memory-cli.js mode custom --text "<your-policy-string>"

# Set arbitrary config keys
node ~/.claude/hermes-memory/memory-cli.js mode set --useLlmExtractor false --nudgeToolCalls 20
```

The change is persisted in `~/.claude/hermes-memory-config.json`.
