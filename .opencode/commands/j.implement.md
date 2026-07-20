# /implement — Execute Plan or Spec

Invoke the `@j.implementer` agent to build what was planned or specified.

## Usage

```
/j.implement
/j.implement <specific task or file>
/j.implement <repo-path>
```

## Examples

```
/j.implement
/j.implement the authentication middleware
/j.implement docs/specs/user-profile.md
/j.implement /Users/kleber.motta/repos/contexts/trp/trp-seller-api
```

## What happens

1. If a repo path or plan/spec/context path is provided, that explicit target takes precedence over the workspace `active-plan.json`.
2. `@j.implementer` reads the active `plan.md` and full `CONTEXT.md` for every write target. The context is not optional business memory.
3. Reads `juninho-config.json` (`workflow` section) to understand implement, watchdog, handoff, and UNIFY behavior.
4. **If `workflow.implement.singleTaskMode` is `true`**: classify direct developer feedback before selecting work. Feedback about the last completed task reopens that task's execution context for a focused correction and amends its commit; it does not create a task or modify `plan.md`. Only otherwise select the next pending task (first incomplete in wave order), finalize it, report status + progress, and STOP.
5. If `/j.implement` receives no specific task/file, it executes against the whole active plan. For multi-project plans, it must iterate all `writeTargets`, resolving each target project's `planPath`, `specPath`, `contextPath`, and state artifact paths to absolute paths before reading or delegating.
5. If a specific task/file or repo path is provided, it narrows scope to that target while still respecting dependencies and the latest `check-review.md` findings.
6. Creates or switches to a single canonical plan branch `feature/{feature-slug}` for the entire run.
6. Delegates each implementation task to its own task-scoped `@j.implementer` subagent so every task starts with a fresh context window.
7. Because all commits land on the same plan branch, task workers commit sequentially even when the plan has multiple tasks in the same wave.
8. Each task writes its own execution lease in `docs/specs/{feature-slug}/state/tasks/task-{id}/execution-state.md` (in the workspace root); periodic heartbeat-only rewrites happen only when `workflow.implement.refreshExecutionHeartbeat` is enabled.
9. If `workflow.implement.watchdogSessionStale` is enabled and a spawned task never writes state or goes stale, the watchdog/orchestrator may launch one retry attempt for that task. When heartbeat refresh is disabled, stale detection uses runtime/session activity instead of rewriting the task state file.
10. Uses the fast pre-commit path while implementing:
    - `.opencode/scripts/lint-structure.sh`
    - `.opencode/scripts/build-verify.sh`
    - `.opencode/scripts/test-related.sh`
    - focused test execution is routed through `.opencode/scripts/run-test-scope.sh`
11. Does NOT auto-invoke `j.validator` after each task commit. Validation is handled by explicit `j.validator` tasks placed at strategic intervals in the plan by the planner.
12. Task state, implementer log, retry budget, and runtime metadata all live under `docs/specs/{feature-slug}/state/` in the **workspace root** (not in each target project). State is centralized regardless of write target count.
13. Canonical task commit bookkeeping is tracked in `docs/specs/{feature-slug}/state/integration-state.json` (workspace root).
14. A task is only marked COMPLETE after its single implementation commit succeeds and task bookkeeping for that commit is recorded successfully.
15. The task commit must contain code/config deliverables only; do not create a second commit for state artifacts during implementation.
16. If `workflow.implement.watchdogSessionStale` is enabled, watchdog notifications may surface stalled sessions, but notifications never block the run.
17. To maintain exactly one commit per task, `git commit --amend` is used ONLY when the current `HEAD` is verified to be this task's own commit (`HEAD` SHA matches the task's `validatedCommit` in `integration-state.json`, or the HEAD subject contains `task {id}`). Otherwise — HEAD is the base branch or an unrelated commit — a NEW commit is created; `--amend` never rewrites a commit that isn't this task's, even if `plan.md` names a candidate SHA to amend (if that SHA isn't HEAD, treat the task commit as nonexistent). This amend-on-resume applies to interrupted attempts and direct developer feedback about the latest completed task in `singleTaskMode`.
18. Exit only when code changes and task-level tests are complete for every write target on `feature/{feature-slug}`.
19. The caller then runs `.opencode/scripts/check-all.sh` or `/j.check` for repo-wide verification.
20. If the repo-wide check fails, delegate back to `@j.implementer` with the failing output and those generated artifacts.
21. If that `/j.check` reentry requires changing work from a task that is already COMPLETE, the harness should create a new follow-up task instead of reopening the completed one.

## History Rules

- A task must commit directly on the canonical plan branch `feature/{feature-slug}`.
- The required history is exactly one implementation commit per task.
- Do not create additional per-task commits for `docs/specs/{feature-slug}/state/**`; optional artifact commits belong to `/j.unify` and are gated by `workflow.unify.commitFeatureArtifacts`.
- If a task needs earlier task code to exist, that relationship must be expressed via `depends` in `plan.md`.
- Closeout docs that should land in git history must be explicit plan tasks, except for optional feature state artifact commits controlled by `/j.unify`.

## Correction Routing Precedence

In `singleTaskMode`, direct developer feedback about the most recently completed implementation task takes precedence over pending-task selection, planner delegation, and todo reminders. Route it to the same task worker with an explicit correction/amend contract. Do not create a new task, invoke `@j.planner`, or modify `plan.md`.

Use a forward-only follow-up task only when the correction is driven by `/j.check`, `check-review.md`, or checker/reviewer output, or when a later task has started, acquired state, validated, or committed. This distinction is mandatory: developer review between single tasks is part of the original task's iterative implementation, not new planned work.

## Delegation Rule (MANDATORY)

You MUST delegate this task to `@j.implementer` using the `task()` tool.
Do NOT implement code yourself — you are the orchestrator, not the executor.

The first delegated `@j.implementer` session is the workflow owner.
It must not immediately delegate the same whole implementation workflow to another generic `@j.implementer`.
Only explicit task-worker prompts such as `Execute task {id} ...` may create child `@j.implementer` sessions, and those prompts must include absolute paths for plan/spec/context/state artifacts and task files. Task workers must read the full `CONTEXT.md` before source files and stop on missing/thin context instead of guessing.

When ANY sub-agent returns output:
- NEVER dismiss it as "incomplete" or "the agent didn't do what was asked"
- NEVER say "I'll continue myself" and take over the sub-agent's job
- Sub-agent unknowns/ambiguities are VALUABLE DATA — forward them to the user via `question` tool
- If the sub-agent's report has gaps, pass those gaps to the user as questions — do NOT fill them yourself

## Canon review (auto-improve)

After a task is marked COMPLETE and its commit is recorded — back in this orchestrating session, independent of the `@j.implementer` session that produced it — check `workflow.review.implement` in `juninho-config.json`:

- If `false`: skip this section.
- If `true`: run the `/j.review-task` flow for the task you just completed. Delegate to `@j.canon-reviewer` (COMMIT mode) in a session independent of the implementer. The reviewer reads the real commit, compares the diff against canon, and writes the verdict to `docs/specs/{feature-slug}/state/tasks/task-{id}/canon-review.json`. On `FAIL` it also improves the canon (committed) and/or harness (uncommitted) — that is the "find the culprit in canon/harness" step.

Then act on the verdict, up to `workflow.review.maxAttempts` attempts per task:

- `PASS`: continue (select the next task, or in `singleTaskMode` report and stop).
- `FAIL`: the pattern was violated and the reviewer has already improved the canon/harness. Undo and redo the task against the improved canon. First confirm the target repo's `HEAD` is this task's `validatedCommit` (from `integration-state.json`); only then `git reset --hard {validatedCommit}^` — never reset a HEAD that isn't this task's commit (stop and report instead). Then clear the task's `execution-state.md` and its `integration-state.json` entry, re-delegate the task to `@j.implementer`, and review again.
- Cap reached: stop and surface `docs/specs/{feature-slug}/state/tasks/task-{id}/canon-review.md` to the developer.

Run this per task, before moving on. In `singleTaskMode`, run it for the single task before reporting and stopping. This is the same review the loop driver dispatches; here it fires from the normal `/j.implement` flow so it works in an interactive session without `npm run loop`.

## After implementation

Run `/j.check` for repo-wide verification only when **all** tasks in the plan are COMPLETE and `workflow.implement.postImplementFullCheck` is `true`. In `singleTaskMode`, do NOT run `/j.check` after each individual task — the full check (formatting + complete test suite) is expensive and belongs at the end of the feature, or when the developer explicitly asks for it.
If `/j.check` fails, invoke `/j.implement` again with the failing output and `check-review.md`.
Treat the `## Reentry Contract` section inside `check-review.md` as the authoritative next-action contract when it is present.
For a `/j.check` correction that applies to completed work, create a new follow-up task first and implement that task forward-only. In `singleTaskMode`, direct developer feedback about the latest completed task always returns to that task for correction and `git commit --amend`; it never alters `plan.md` or delegates to `@j.planner`. If later task work exists, ask the developer whether to use `/j.patch` or create a follow-up task.
Run `/j.unify` only after the full check passes and `juninho-config.json` enables UNIFY.
