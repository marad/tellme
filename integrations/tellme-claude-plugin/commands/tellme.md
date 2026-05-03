---
description: Speak text aloud with tellme (or read the last assistant response if no argument is given)
allowed-tools: Bash
---

Run the `tellme` CLI to speak text aloud.

If `$ARGUMENTS` is non-empty, run:

```bash
tellme "$ARGUMENTS"
```

If `$ARGUMENTS` is empty, speak your most recent assistant response by piping it on stdin:

```bash
echo "<your last response text>" | tellme
```
