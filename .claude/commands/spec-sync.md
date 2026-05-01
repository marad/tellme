# /spec-sync — apply pending spec changes to the code

Run the full sync loop on a specific spec: generate a plan, fill it, get human approval, implement, verify, seal. This is where specs become code.

## Mental model recap

A spec drifts from its snapshot when the user edits it; sync is the operation that brings the code back in line with the spec. Specman generates a plan scaffold (one section per drifted AC). Your job is to fill in the **Approach** and **Files** for each AC and the **Verification** commands at the bottom — then wait for the user to approve the plan before implementing. Each implementation commit must carry a `Spec: FEAT-NNNN/AC-N` trailer so specman can verify coverage at seal time.

## Step 1 — Confirm the target

The user has invoked `/spec-sync FEAT-NNNN`. Sanity-check:

```bash
specman status FEAT-NNNN  # or just `specman status` and read the line
```

- If `in-sync`: there's nothing to sync. Tell the user.
- If `new` or `drifted` with AC drift: proceed to step 2.
- If `drifted` with editorial-only drift: tell the user to run `specman seal FEAT-NNNN` instead — sync will refuse and tell them this anyway.

If the working tree is dirty (uncommitted changes outside the plan file), sync will refuse. Tell the user to commit or stash first.

## Step 2 — Generate the plan scaffold

```bash
specman sync FEAT-NNNN
```

This creates `.specman/plans/FEAT-NNNN.md` with one `## AC-N (added|modified|removed)` section per drifted AC, each containing empty `Approach:` and `Files:` lines, plus an empty `## Verification` section at the bottom. Read the file end-to-end before filling.

## Step 3 — Fill the plan

For each AC section, write:

- **Approach:** A short prose description of how this AC will be satisfied. Reference existing functions and files when the AC reuses them ("Already implemented at `src/foo.ts:42`") and describe new code when introducing it. If multiple ACs share an approach, say so and don't repeat it.
- **Files:** The list of files that will be created or modified. Use relative paths from the project root.

For the **Verification** section: list the shell commands specman should run after implementation, one per line. Typically:

- The test command (e.g. `deno test --allow-all`, `cargo test`, `npm test`).
- Any smoke tests or integration checks specific to the change.
- Each command runs sequentially via `sh -c` from the repo root; non-zero exit fails sync. Specman also fails verification if a command leaves the working tree dirty.

Examples of good Approach text from past plans:

> Already implemented. `runVerification` (src/sync.ts:305) iterates plan commands sequentially via `runShellCommand`.

> NEW CODE: 1. In `cli.ts`, add a `--dry-run` flag parser. 2. Implement `dryRunReport(root): DryRunResult` in `src/sync.ts` ...

The plan is the **audit-trail commit** for "what we intended when we last synced this spec." Keep it specific and accurate.

## Step 4 — STOP. Human approval gate.

**This is a hard gate. Do not implement before the user approves the plan.**

Show the user the plan and ask explicitly: "Plan written to `.specman/plans/FEAT-NNNN.md`. Please review. Approve, request changes, or abort?" Three valid responses:

- **Approve** → proceed to step 5.
- **Re-plan** → revise the plan with their feedback, return to this gate.
- **Abort** → stop and tell the user the spec remains drifted; they can pick this back up later.

The plan-review gate is the user's chance to redirect implementation before any code is written. Skipping it defeats the auditability the workflow exists for.

## Step 5 — Implement

For each AC, follow the Approach. Write the code, the tests, and any documentation the AC requires.

**Each commit must include a `Spec: FEAT-NNNN/AC-N` trailer** identifying at least one AC the commit addresses. Multiple ACs in one commit is fine (`Spec: FEAT-0013/AC-1` and `Spec: FEAT-0013/AC-2` on separate trailer lines, or in a comma-list — match your team's convention). Specman checks at seal time that every commit since sync started carries a matching trailer; one without will fail the seal.

Suggested commit message format:

```
implement AC-1, AC-2: <brief>

<one-paragraph body if needed>

Spec: FEAT-NNNN/AC-1
Spec: FEAT-NNNN/AC-2
```

Implementation is iterative. Tests, edits, retests. Don't push a commit you haven't run tests against locally.

## Step 6 — Verify

When you believe the implementation is complete:

```bash
specman verify FEAT-NNNN
```

This re-runs the plan's Verification commands sequentially. On any failure, it surfaces the failing command's output and the exit code. Do not seal until verification is clean.

If verification fails:
- Read the failure carefully — stdout, stderr, exit code.
- Fix the underlying issue.
- Commit the fix (with a `Spec:` trailer naming the AC it relates to).
- Re-run verify.

Keep iterating until verify exits zero with `All verification commands passed. Tree is clean.`

## Step 7 — Seal

When verify is green, sync the seal step writes the snapshot commit automatically:

If you ran the full sync flow via `specman sync FEAT-NNNN`, sync continues from green verification through to the snapshot commit. You're done — the spec is `in-sync`.

If you ran `verify` standalone (not via the sync loop), and verify is green, the user can `git status` and confirm; sync's seal is part of `specman sync`, not `specman verify`.

Tell the user: "FEAT-NNNN is in-sync. Snapshot committed."

## Failure recovery

- **Verification fails late in implementation:** fix and retry. Specman picks up where you left off — your plan and your implementation commits remain.
- **Trailer check fails on seal:** specman names the offending commit. Either rewrite that commit's message to add the trailer (with care — it's a history rewrite) or amend the change into a new commit that does carry one.
- **User changes their mind mid-implementation:** abort. Existing implementation commits stay in history (with their `Spec:` trailers); the spec remains drifted. The user can pick it up later with another `specman sync FEAT-NNNN`.

## Reference

- `docs/workflow.md` — the lifecycle in detail.
- `docs/commands.md` — `sync`, `verify`, `seal` flag reference.
- The plan format (FEAT-0009) constrains how plans are structured; specman generates them, you fill them.
