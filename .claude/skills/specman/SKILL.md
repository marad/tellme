---
name: specman
description: Use when working with specifications, specman, acceptance criteria, drift detection, or sync workflows. Routes to /spec, /spec-sync, /spec-status as needed.
---

# Specman

You are working in a project that uses **specman**, a spec-driven development tool. Specifications live in `specs/` as markdown files; implementation snapshots live in `.specman/implemented/`. Your job in this project is to keep the two in sync — and to help the user evolve the specs themselves.

## Mental model

Specs describe **what**. Code describes **how**. The arrow runs one direction: specs → code. Code never modifies specs.

A spec file has YAML frontmatter (`id`, `title`, `status`, `depends_on`) and markdown sections. **Intent** explains *why* the feature exists. **Acceptance criteria** are the testable success conditions — written in Given/When/Then form, each with a stable `AC-N` ID. ACs are the only part of a spec that drives implementation: rewording the Intent is editorial, but adding or changing an AC is a real change that requires the code to follow.

Each spec has a state, observable via `specman status`:

- **`new`** — spec exists but has never been implemented
- **`drifted`** — spec has been edited since it was last sealed; the implementation is behind
- **`in-sync`** — implementation matches the snapshot of the spec

**Drift is a feature, not a bug.** When the user edits a spec, it should drift from the snapshot. That drift is the signal saying "the spec moved ahead of the code; bring the code along." Specman doesn't try to prevent drift — it detects it, measures it, and gives the tools to resolve it.

## The lifecycle

```
specman new "Title"            # creates a scaffold in specs/
$EDITOR specs/FEAT-NNNN-...md  # human (or you, with their guidance) writes Intent + ACs
specman validate               # checks structure + finds errors
specman sync FEAT-NNNN         # generates a plan (one entry per drifted AC)
                               # → human reviews, agent implements, tests run
specman verify FEAT-NNNN       # re-runs the plan's verification commands
                               # → on green, snapshot is sealed and committed
```

For purely editorial changes (rewording Intent, fixing typos — no AC drift), `specman seal FEAT-NNNN` skips the sync loop and just updates the snapshot.

## Reading `specman status`

```
FEAT-0001 drifted  (changed since last sync)
FEAT-0002 new      (no snapshot yet)
3 specs in-sync
```

- `drifted`: spec edited since its last snapshot. The drift might be AC-level (needs `specman sync`) or editorial-only (needs `specman seal`).
- `new`: never been implemented or sealed. `specman sync` will treat the whole spec as the drift set.
- in-sync specs are summarized as a count unless `--verbose` is passed.

`specman status --diff` shows the unified diff of every drifted spec against its snapshot — read this before deciding whether the change is AC-level or editorial.

## Routing user requests

When the user asks you to *do something* with specs in this project, route them to the right slash command:

- **"I want to add / change / refine a feature"** → `/spec`. This is authoring. The slash command will help decide whether the user's intent fits an existing spec (an update) or warrants a new one.
- **"Implement / build / sync this spec"** → `/spec-sync`. This kicks off the full sync loop on a specific spec.
- **"What's the state of my specs? What should I work on next?"** → `/spec-status`. Triage and recommend.

If the user's request is ambiguous, ask which one they mean before invoking. If they're just asking a question about specman conventions (this skill is loaded), answer from the mental model above without invoking a slash command.

## The new-vs-update routing principle

This is the single most important judgment call in spec authoring, and it's what `/spec` exists to handle. The principle:

> **Prefer updating an existing spec when the change is a refinement or extension of an established feature. Prefer a new spec when the scope is genuinely separable.**

Concretely:
- A new acceptance criterion that fits the existing Intent and Behavior of FEAT-X → update FEAT-X.
- A new failure mode, edge case, or platform variant of an existing feature → update.
- A feature whose Intent is a different problem from anything in `specs/` → new spec.
- A feature whose Intent restates an existing spec from a different angle → almost always an update.

When in doubt, ask the user. The cost of a misrouted spec (split when it should be one, or merged when it should be split) is later confusion; surfacing the ambiguity now is cheaper.

## Working style

- **Specs are prose, not bullet outlines.** Intent and Behavior are paragraphs that read like documentation. Constraints and Out-of-scope are bullet lists. ACs are numbered Given/When/Then statements. Match the style of the existing files in `specs/`.
- **Write Intent as a problem, not a solution.** "Let users regain access to their account" — not "Implement a password-reset endpoint."
- **ACs are testable, stable, independent.** Once assigned, an `AC-N` ID never changes meaning. Avoid ACs that only make sense as a group.
- **The human owns intent.** You can draft, refine, and validate, but the human approves what goes into Intent and ACs. When you're unsure, ask.
- **Each commit during a sync references the AC it addresses** via a `Spec: FEAT-NNNN/AC-N` trailer. Specman checks this at seal time and refuses to seal if any commit lacks a trailer.

## Reference

- `docs/philosophy.md` — the deeper rationale for the model
- `docs/spec-format.md` — the spec file format
- `docs/writing-specs.md` — best practices and anti-patterns
- `docs/workflow.md` — the full lifecycle in detail
- `docs/commands.md` — every CLI command and flag
