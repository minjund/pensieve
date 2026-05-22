---
name: memory-preview-context
description: Preview the exact memory-policy + memory-context block the hook would inject into UserPromptSubmit. Args - optional --project NAME, --json.
---

# memory-preview-context

```powershell
# Print the additionalContext text that UserPromptSubmit would emit
node ~/.claude/hermes-memory/memory-cli.js preview-context

# Scope to a specific project (overrides active)
node ~/.claude/hermes-memory/memory-cli.js preview-context --project myrepo

# Machine-readable
node ~/.claude/hermes-memory/memory-cli.js preview-context --json
```

Use this to verify what the agent will see at session start, including the policy block style (full/compact/none/custom set via `/memory-mode`), the active-project tag, and the truncated `<memory-context>` containing global + project tier entries.
