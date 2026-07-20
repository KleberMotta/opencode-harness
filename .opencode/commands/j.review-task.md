# /review-task — Independent canon review of the latest completed task

Invoke the `@j.canon-reviewer` agent (COMMIT mode) to review the candidate commit of the most
recent COMPLETE task against the canon, in a session that is independent of the producer.

This command takes no arguments — the target is resolved from disk, exactly like the loop driver does.

## Usage

```
/j.review-task
```

## What runs

1. Resolve the active feature `slug` from `.opencode/state/active-plan.json`.
2. Resolve the target task = the COMPLETE task with the greatest `execution-state.md` mtime that
   does NOT yet have a `docs/specs/{slug}/state/tasks/task-{id}/canon-review.json` recording a
   `verdict` for the task's current manifest commit (`integration-state.json` → `tasks[id].validatedCommit`).
3. Resolve the candidate commit SHA (the task's `validatedCommit`) and the target repo root
   (`writeTargets[].targetRepoRoot`).
4. Delegate to `@j.canon-reviewer` in **COMMIT mode**, passing the absolute paths: `slug`, `task id`,
   `commit SHA`, `plan.md`, task dir, and the target repo root. Include `Stage: canon-review` in the
   delegation prompt so the runtime tags this session as the reviewer.

## Delegation Rule (MANDATORY)

You MUST delegate this command to `@j.canon-reviewer` using the `task()` tool. Do NOT run the
review yourself — you are the orchestrator, not the reviewer.

`@j.canon-reviewer` is responsible for reading the real commit, running the mechanical shortcut
(`.opencode/cli/canon-audit.ts`), comparing the diff against canon, writing the verdict to
`docs/specs/{slug}/state/tasks/task-{id}/canon-review.json` (+ a short `canon-review.md`), and —
on FAIL — improving the canon (committed) and/or harness (uncommitted).

Undoing a FAIL (git reset + state cleanup + re-implement) is the **loop driver's** job, never this
command's and never the reviewer's.
