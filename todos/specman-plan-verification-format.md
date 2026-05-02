# Specman plan verification command format

`specman verify` only recognizes verification commands written as a bullet
list with backtick-wrapped commands:

```markdown
## Verification

- `npm test`
- `npm run lint`
```

Fenced code blocks are silently ignored — the parser reports
"zero runnable commands" even when the fence contains a valid command:

```markdown
## Verification

```
npm test
```
```

Hit while syncing FEAT-0001 (commit 1dd58da fixed it). Worth remembering
when filling plans for FEAT-0002 and FEAT-0003 — and worth opening an
upstream issue against specman to either accept fenced blocks or print
a clearer "expected bulleted commands, found fenced block" message
instead of "zero runnable commands."
