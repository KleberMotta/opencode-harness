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
/j.implement /Users/kleber.motta/repos/olxbr/trp-seller-api
```

## What happens

1. If a repo path or plan/spec/context path is provided, that explicit target takes precedence over the workspace `active-plan.json`.
2. `@j.implementer` reads the active `plan.md` and full `CONTEXT.md` for every write target. The context is not optional business memory.
3. Reads `juninho-config.json` (`workflow` section) to understand implement, watchdog, handoff, and UNIFY behavior.
4. **If `workflow.implement.singleTaskMode` is `true`**: execute only the next pending task (first incomplete in wave order), finalize it, report status + progress to the developer, and STOP. Do not proceed to the next task. The developer must invoke `/j.implement` again to continue.
5. If `/j.implement` receives no specific task/file, it executes against the whole active plan. For multi-project plans, it must iterate all `writeTargets`, resolving each target project's `planPath`, `specPath`, `contextPath`, and state artifact paths to absolute paths before reading or delegating.
5. If a specific task/file or repo path is provided, it narrows scope to that target while still respecting dependencies and the latest `check-review.md` findings.
6. Creates or switches to a single canonical plan branch `feature/{feature-slug}` for the entire run.
6. Delegates each implementation task to its own task-scoped `@j.implementer` subagent so every task starts with a fresh context window.
7. Because all commits land on the same plan branch, task workers commit sequentially even when the plan has multiple tasks in the same wave.
8. Each task writes its own execution lease in `docs/specs/{feature-slug}/state/tasks/task-{id}/execution-state.md`; periodic heartbeat-only rewrites happen only when `workflow.implement.refreshExecutionHeartbeat` is enabled.
9. If `workflow.implement.watchdogSessionStale` is enabled and a spawned task never writes state or goes stale, the watchdog/orchestrator may launch one retry attempt for that task. When heartbeat refresh is disabled, stale detection uses runtime/session activity instead of rewriting the task state file.
10. Uses the fast pre-commit path while implementing:
    - `.opencode/scripts/lint-structure.sh`
    - `.opencode/scripts/build-verify.sh`
    - `.opencode/scripts/test-related.sh`
    - focused test execution is routed through `.opencode/scripts/run-test-scope.sh`
11. Spawns `@j.validator` after each task commit to validate the just-implemented task against spec/plan intent, QA expectations, and code quality expectations within task scope.
12. Task state, validator state, implementer log, retry budget, and runtime metadata all live under `docs/specs/{feature-slug}/state/` in each task's target project repo root. Multi-project runs must keep state isolated per write target.
13. Canonical task commit bookkeeping is tracked in `docs/specs/{feature-slug}/state/integration-state.json`.
14. A task is only marked COMPLETE after its single implementation commit succeeds, validator approval is written, and the task bookkeeping for that commit is recorded successfully.
15. The task commit must contain code/config deliverables only; do not create a second commit for state artifacts during implementation.
16. If `workflow.implement.watchdogSessionStale` is enabled, watchdog notifications may surface stalled sessions, but notifications never block the run.
17. Before final exit on a successful whole-feature run, request a feature-level validator pass for each write target to write that target project's `docs/specs/{feature-slug}/state/functional-validation-plan.md`.
18. Exit only when code changes, task-level tests, and target-local functional validation plans are complete for every write target on `feature/{feature-slug}`.
19. The caller then runs `.opencode/scripts/check-all.sh` or `/j.check`, which validate the canonical plan branch using `check-review.md` plus `functional-validation-plan.md`.
20. If the repo-wide check fails, delegate back to `@j.implementer` with the failing output and those generated artifacts.
21. If that reentry requires changing work from a task that is already COMPLETE, the harness should create a new follow-up task instead of reopening the completed one.

## History Rules

- A task must commit directly on the canonical plan branch `feature/{feature-slug}`.
- The required history is exactly one implementation commit per task.
- Do not create additional per-task commits for `docs/specs/{feature-slug}/state/**`; optional artifact commits belong to `/j.unify` and are gated by `workflow.unify.commitFeatureArtifacts`.
- If a task needs earlier task code to exist, that relationship must be expressed via `depends` in `plan.md`.
- Closeout docs that should land in git history must be explicit plan tasks, except for optional feature state artifact commits controlled by `/j.unify`.

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

## After implementation

Run `/j.check` for repo-wide verification.
If `/j.check` fails, invoke `/j.implement` again with the failing output, `check-review.md`, and `functional-validation-plan.md`.
Treat the `## Reentry Contract` section inside `check-review.md` as the authoritative next-action contract when it is present.
If the correction applies to already completed work, create a new follow-up task first and implement that task forward-only.
Run `/j.unify` only after the full check passes and `juninho-config.json` enables UNIFY.
