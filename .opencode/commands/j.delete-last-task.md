# /delete-last-task — Drop the last task's commit and delete its state

Completely removes the most recently completed task from the active feature: drops its commit from the branch and deletes its state files under `docs/specs/{feature-slug}/state/tasks/task-{id}/`. This is destructive — it asks for confirmation before doing anything.

## Usage

```
/j.delete-last-task
```

Takes no arguments — the target is the last completed task, resolved from disk.

## What runs

1. Resolve the active feature `slug` from `.opencode/state/active-plan.json`.
2. Resolve the target task = the COMPLETE task with the greatest `execution-state.md` mtime under `docs/specs/{slug}/state/tasks/`. Read its `validatedCommit` and the target repo root from `docs/specs/{slug}/state/integration-state.json` (`tasks[id].validatedCommit`, `writeTargets[].targetRepoRoot`).
3. **Identity guard (MANDATORY).** The commit may be dropped ONLY if it is the current `HEAD` of the target repo: `git rev-parse HEAD` equals the task's `validatedCommit`, AND the HEAD subject (`git log -1 --format=%s`) contains `task {id}`. If `HEAD` is a different commit — the base branch, another task, or an unrelated commit — STOP and report; do NOT reset. A non-tip task commit cannot be dropped cleanly here (that needs an interactive rebase) — tell the developer to resolve it manually. This guard exists so the command never rewrites a commit that is not this task's own.
4. **Confirmation (MANDATORY).** Using the `question` tool, show the developer exactly what will be removed and ask them to confirm:
   - feature slug + task id;
   - the commit that will be dropped: `{sha}` `{subject}` (from `git show --stat {sha}`);
   - the state directory that will be deleted: `docs/specs/{slug}/state/tasks/task-{id}/`;
   - a plain warning that the commit AND its code changes are discarded (`git reset --hard HEAD^`), and are only recoverable from the reflog.

   Proceed ONLY on an explicit "yes". On anything else, stop and change nothing.
5. On confirmation, in the target repo root:
   - `git reset --hard HEAD^` — drops the task's commit and its working-tree changes.
6. Delete the task's state — the per-task directory AND the task's entries in the two shared state files at `docs/specs/{slug}/state/`:
   - Remove the directory `docs/specs/{slug}/state/tasks/task-{id}/`.
   - `integration-state.json`: remove the `tasks[{id}]` entry (leave every other task's entry intact).
   - `implementer-work.md`: remove this task's section — the `## Task {id} — …` heading and everything under it up to the next `## Task ` heading (or end of file). Leave every other task's section untouched.
7. Report: the dropped commit SHA, the new `HEAD` (`git log -1 --oneline`), the deleted per-task state path, and that the `integration-state.json`/`implementer-work.md` entries for task {id} were removed. Mention the reflog entry so the developer knows the commit is recoverable.

## Rules

- Never `git reset` a `HEAD` that is not the task's own commit (the identity guard in step 3). This is the same rule the implementer's amend follows — a `reset --hard`/`--amend` blindly rewrites `HEAD`, so identity must be verified first.
- Only the state under `docs/specs/{slug}/state/tasks/task-{id}/` is deleted — never another task's state, `plan.md`, `spec.md`, `CONTEXT.md`, or the whole `state/` folder.
- This command is for throwing away a task you want to redo from scratch. It does not modify `plan.md` and does not delegate to `@j.planner`.
- If the feature has more than one write target and the task committed to more than one repo, apply steps 3–5 to each target repo that holds the task commit; report each.
