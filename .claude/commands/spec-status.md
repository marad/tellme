# /spec-status — what's the state of the specs and what's next?

Quick triage of the project's specifications. Run the status commands, interpret the output, and recommend the next action.

## Mental model recap

Every spec in `specs/` is in one of three states:

- **`new`** — never sealed. The spec exists but no implementation snapshot was ever written.
- **`drifted`** — the spec has been edited since its last snapshot. The drift is either AC-level (needs `specman sync`) or editorial-only (needs `specman seal`).
- **`in-sync`** — the spec matches its snapshot byte-for-byte after canonicalization. Nothing to do.

Your job here is short: report what's drifted, classify the drift, and point the user at the next concrete step.

## Step 1 — Run status

```bash
specman status
```

Output looks like:

```
FEAT-0001 drifted  (changed since last sync)
FEAT-0002 new      (no snapshot yet)
3 specs in-sync
```

If everything is in-sync, the output is just a count line. Tell the user the project is clean and suggest `/spec` if they want to author or refine something.

## Step 2 — Classify each drifted spec

For each `drifted` line, find out whether the drift is AC-level or editorial:

```bash
specman status --diff
```

This appends a unified diff per drifted spec. Look at the diff:

- **AC-level**: the diff includes added, removed, or changed `AC-N:` lines in `## Acceptance criteria`. The change requires sync.
- **Editorial**: the diff is all in `## Intent`, `## Behavior`, frontmatter prose, or other non-AC sections. The implementation is still correct; only the snapshot needs updating via seal.

Be careful: an AC-N line whose criterion text changed (even by a word) is AC-level drift. Re-wording an AC counts as a meaning change because future test references and commits anchor on AC-N's content.

## Step 3 — Recommend the next action

Pick the highest-leverage next step and tell the user:

- **One spec drifted, AC-level:** "`/spec-sync FEAT-NNNN` to plan and apply the changes."
- **One spec drifted, editorial-only:** "`specman seal FEAT-NNNN` to update the snapshot. (Editorial-only — the code is already correct.)"
- **Multiple drifted specs:** suggest tackling them in dependency order. If any have `depends_on` relationships, sync the dependencies first. `specman sync` (no ID) processes all drifted/new specs in dependency order automatically — mention this if it fits.
- **Only `new` specs, no drift:** "`/spec-sync FEAT-NNNN` to do the initial implementation, or `specman seal --initial FEAT-NNNN` if the implementation already exists in the codebase and you just want to seal the first snapshot."
- **Mix of new and drifted:** lead with the most urgent one (usually one the user is actively working on, or the deepest dependency).
- **Everything in-sync:** "Nothing to apply. If you want to add a feature or refine an existing one, use `/spec`."

When uncertain, ask the user which spec they want to focus on rather than guessing.

## Optional — depth check

If the user wants more detail, walk them through the specifics of any one drifted spec:

1. Show the unified diff for that spec from `specman status --diff` output.
2. Point out which sections changed.
3. Confirm AC-level vs editorial classification.
4. State the recommended command.

Keep it under five lines unless asked for more.

## Common pitfalls

- **Don't skip the diff.** Classifying drift as editorial vs AC-level by guessing the file's title or status is unreliable. Read the diff.
- **Don't run sync or seal yourself** unless the user explicitly asks. `/spec-status` is read-only triage. Recommendations go to the user; the user executes (or asks you to).
- **Working-tree dirt blocks sync.** If `git status` shows uncommitted changes outside `.specman/plans/`, mention this — sync will refuse until the tree is clean.

## Reference

- `docs/workflow.md` — what each state means in the lifecycle.
- `docs/commands.md` — `status`, `sync`, `seal`, `verify` flag reference.
