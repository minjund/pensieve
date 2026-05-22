---
name: skill-patch
description: Update a single section of an existing skill. Args - "<name> <section> <content>" where section is when_to_use|procedure_steps|pitfalls|verification_steps.
---

# skill-patch

```powershell
node ~/.claude/hermes-memory/memory-cli.js skill-patch deploy-canary pitfalls "Canary metrics window must be at least 10 minutes"
```

Sections (`section` arg):

- `when_to_use` -- maps to `## When to use`
- `procedure_steps` -- maps to `## Procedure`
- `pitfalls` -- maps to `## Pitfalls`
- `verification_steps` -- maps to `## Verification`

If the section does not exist yet it is appended. Frontmatter is preserved.
