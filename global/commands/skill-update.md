---
name: skill-update
description: Replace a skill's description or full body. Args - "<name>" with --description or --body.
---

# skill-update

```powershell
# Just rewrite the description (one-liner shown in skill listings)
node ~/.claude/hermes-memory/memory-cli.js skill-update deploy-canary --description "Run a 5% canary, watch for 10 min, then promote"

# Replace the whole body
node ~/.claude/hermes-memory/memory-cli.js skill-update deploy-canary --body "# deploy-canary\n\n## Procedure\n1. ...\n"
```

Use `skill-patch` for targeted section edits; use `skill-update` only when you want to rewrite the description or body wholesale.
