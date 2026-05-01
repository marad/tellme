# /spec — author or update a specification

Help the user change the project's specification. The user's request might land in a new spec, an update to one or more existing specs, or a split across multiple. Your first job is to figure out which.

## Mental model recap

Specifications live in `specs/` as markdown files. They drive implementation: each spec has acceptance criteria (`AC-N`) that the code must satisfy. Specs describe *what*; code describes *how*. Editing a spec doesn't change the code — it puts the spec ahead of the code (drift), and the user later runs `/spec-sync` to bring the code along. Your job in `/spec` is upstream of all of that: get the spec right, then hand off.

## Step 1 — Understand the user's intent

Ask the user what they want to change in the project's behavior. Listen for:
- **A new feature** — something the project doesn't do today.
- **A refinement** — tightening, clarifying, or extending an existing feature.
- **A new edge case** — a failure mode, platform variant, or constraint not currently captured.
- **A correction** — the spec is wrong about something the code already does (or should do).

If the user's request is fuzzy, ask one clarifying question at a time. Don't proceed with a spec edit on an unclear intent — the spec will be unclear and the resulting plan will be unclear.

## Step 2 — Route: new spec or update?

Before touching any file, decide where the change lands.

1. **List existing specs** with `ls specs/` (or recursively if there are subfolders). Read the titles and Intent sections for any that look topically related.
2. **Apply the routing principle:** prefer updating when the change is a refinement or extension of an established feature; prefer a new spec when scope is genuinely separable.
3. **Surface ambiguity to the user.** If two specs both look plausible, or if you can't tell whether something is "extension of A" or "new feature B," tell the user the options and let them choose.

Concrete heuristics:
- Adding an AC that fits the existing Intent and Behavior of FEAT-X → update FEAT-X.
- Adding a platform variant or edge case to an established feature → update.
- Reframing a feature from a different angle while the underlying problem is the same → almost always an update; resist the urge to create a parallel spec.
- A feature whose Intent describes a problem that no existing spec addresses → new spec.

When in doubt, ask: "I see two ways to land this — extending FEAT-0007 with a new AC, or creating a new FEAT for it. Which fits your mental model?"

## Step 3a — New spec flow

If the change is a new spec:

```bash
specman new "Concise human-readable title"
```

This creates `specs/FEAT-NNNN-<slug>.md` with a scaffold containing required frontmatter and empty `## Intent` and `## Acceptance criteria` headings. The file isn't yet a valid spec — `specman validate` will flag it as incomplete. Your job is to fill it in.

Help the user write **Intent**:
- One short paragraph explaining *why* this feature exists.
- Frame as a problem, not a solution. "Let users recover their account" — not "Add a password-reset endpoint."
- Mention the cost of *not* having it, when that adds clarity.

Help the user write **Acceptance criteria**:
- Each AC is one numbered `AC-N` line in Given/When/Then or Given/Then form.
- Testable: a concrete test could verify each AC.
- Stable: once assigned, `AC-N` never reuses for a different criterion. Don't worry about gaps — gaps are fine.
- Independent: each AC is implementable and testable on its own.
- Avoid implementation detail. "Sessions expire after 24 hours" — not "Use Redis with 24h TTL and LRU eviction."

Optionally help the user add **Behavior**, **Constraints**, **Examples**, **Out of scope**, **Non-goals**, **Open questions** when they add value. Skip them when they don't.

## Step 3b — Update flow

If the change is an update to an existing spec:

1. Read the spec end-to-end before editing. Don't paraphrase — load the actual file.
2. **Add new ACs as additional `AC-N` lines** with the next free number. Don't renumber existing ACs.
3. **Modify existing ACs** only when the criterion is genuinely changing meaning. Reword carefully — the AC ID is a stable anchor referenced by past commits.
4. **Refining Intent or Behavior** without changing ACs is editorial. The spec will go drifted but only `specman seal` is needed at closeout, not a full sync.
5. **Removing an AC** is meaningful: it says the criterion is no longer required. Do it deliberately and explain why in the conversation, even if the spec itself doesn't.

## Step 4 — Validate

Run validation:

```bash
specman validate
```

Errors block; fix them. Common ones:
- `E005` — required section (Intent or Acceptance criteria) is empty. Fill it.
- `E002` — required frontmatter field missing.
- `E008` — duplicate AC ID. Renumber.
- `E006` / `E007` — broken or cyclic `depends_on`. Adjust.

Iterate until validation is clean.

## Step 5 — Closeout: AC drift or editorial?

Run `specman status` and `specman status --diff` to see what changed.

- **AC-level drift** (ACs added, modified, or removed): the implementation needs to follow. Tell the user: "The spec is ready. Run `/spec-sync FEAT-NNNN` to plan and implement the changes." Don't run sync yourself unless asked — sync is its own workflow with its own approval gates.
- **Editorial-only drift** (Intent / Behavior reworded, no AC changes): the implementation is still correct. Suggest:

  ```bash
  specman seal FEAT-NNNN
  ```

  This updates the snapshot without invoking the sync loop. Confirm with the user before sealing — the user owns the decision about whether the change is editorial.

## Tone and judgment

- **Don't write specs the user didn't ask for.** Stay in the scope of what they brought you.
- **Don't invent acceptance criteria the user hasn't endorsed.** Draft, then check.
- **Push back gently** when the user's framing is wrong (e.g. they're asking for a solution disguised as a problem). Specs describe problems.
- **When the routing or ambiguity is genuinely unclear, ask.** Surfacing the question now is cheaper than untangling a misrouted spec later.

## Reference

- Existing specs in `specs/` are the canonical style guide — match their voice and structure.
- `docs/writing-specs.md` covers patterns and anti-patterns in detail.
- `docs/spec-format.md` is the file-format reference.
