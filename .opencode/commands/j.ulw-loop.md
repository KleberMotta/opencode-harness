# /ulw-loop — Ultra Work Loop

Activate high-throughput mode — work until all tasks in the plan are complete.

## Usage

```
/j.ulw-loop
/j.ulw-loop <task or goal>
```

## What happens

1. Reads task list from the active `plan.md` (auto-loaded by plan-autoload plugin for all write targets)
2. Reads `.opencode/state/active-plan.json` to discover all write targets
3. For multi-project plans, iterates all write targets — each target has its own `plan.md` and `docs/specs/{feature-slug}/state/` tree
4. Reads feature-local state from each target's `docs/specs/{feature-slug}/state/`, especially `implementer-work.md` and prior task execution files
5. Identifies tasks that can run in parallel (no dependencies)
6. Creates or switches to the shared implementation branch `feature/{feature-slug}` in each target repo
7. Delegates each task to its own task-scoped `@j.implementer` subagent with the task's `targetRepoRoot` so every task gets a fresh context window scoped to its target project
8. Executes those task workers sequentially on the shared branch
9. Each task reads dependency execution/validator state before coding and writes state to its target repo root (`$REPO_ROOT/docs/specs/{feature-slug}/state/`)
10. Each task writes `tasks/task-{id}/execution-state.md`; heartbeat-only rewrites are optional and controlled by `workflow.implement.refreshExecutionHeartbeat`
    - Retry budget is tracked per task in `tasks/task-{id}/retry-state.json`
11. If `workflow.implement.watchdogSessionStale` is enabled and a task never starts or goes stale, the loop may launch one retry attempt for that task
12. If `workflow.implement.watchdogSessionStale` is enabled, a watchdog notification may surface stalled sessions without blocking the run
13. `@j.validator` runs after each task, writing results to the target's `docs/specs/{feature-slug}/state/tasks/task-{id}/validator-work.md`
14. Loop continues until all tasks across all write targets are marked complete
15. Record each APPROVED task commit in the target's `docs/specs/{feature-slug}/state/integration-state.json`
16. Run `/j.check` once task-level work is done; this must validate the canonical plan branch in every target repo
17. `@j.unify` runs only if closeout is enabled in `juninho-config.json` under `workflow.unify.enabled` and should only do closeout/cleanup/PR work

## When to use

- Many independent tasks in the backlog
- Large feature that can be parallelized
- When you want the highest safe throughput

## Execution model

```
Wave 1:
  task-worker-1: implement service layer     → commit on feature/{slug}
  task-worker-2: implement API routes        → commit on feature/{slug}
  task-worker-3: implement UI components     → commit on feature/{slug}

Wave 2:
  task-worker-4: wire everything together    → commit on feature/{slug}

Wave 3:
  task-worker-5: unit tests                  → commit on feature/{slug}
  task-worker-6: integration tests           → commit on feature/{slug}
```

## Safety

- Each task gets a fresh task-scoped subagent session
- All state files go to repo root, so the orchestrator always has visibility
- Shared-branch execution keeps commit history linear and predictable
- Each task carries its own lease in feature-local state; heartbeat-only file updates are opt-in
- Stale tasks can be retried once without allowing two attempts to commit concurrently
- Cleanup applies only to harness bookkeeping artifacts recorded in `integration-state.json`
- Code integration happens immediately because each task commits directly into the canonical feature branch
- UNIFY performs cleanup only; it must not be responsible for first-time code integration
- If any wave fails, the loop pauses and reports blockers — read `docs/specs/{slug}/state/` for details
