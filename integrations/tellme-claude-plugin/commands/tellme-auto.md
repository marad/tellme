---
description: Toggle tellme auto-read for the current project (off by default, persisted in .claude/tellme.json)
allowed-tools: Bash
---

Toggle auto-read for this project. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/toggle-auto.mjs"
```

Report the new state to the user (ON or OFF) verbatim from the script's output.
