# /implement-task — Execute One Plan Task

Invoke the `@j.implementer` agent to execute exactly one task from an active plan.

## Usage

```
/j.implement-task <feature-slug>/task<id>
/j.implement-task <feature-slug>/task-<id>
/j.implement-task <project>:<feature-slug>/task<id>
/j.implement-task <feature-slug>/task<id> --project <project>
```

## Examples

```
/j.implement-task seller-creation-service/task1
/j.implement-task seller-creation-service/task-1
/j.implement-task olxbr/trp-infra:seller-creation-service/task1
/j.implement-task seller-creation-service/task1 --project olxbr/trp-infra
```

## What happens

1. Parses the argument into `{feature-slug}`, `{task-id}`, and optional `{project}`.
2. Reads the workspace `.opencode/state/active-plan.json`.
3. Verifies the active plan slug matches `{feature-slug}`. If it does not match, stop and ask the user to run `/j.activate-plan <plan-path>` first.
4. Resolves spec artifacts from the workspace: `$WORKSPACE_ROOT/docs/specs/{feature-slug}/plan.md`, `spec.md`, `CONTEXT.md`. State lives under `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/`.
5. If `{project}` was provided, match it against `writeTargets[].project` exactly first. If no exact match exists, allow an unambiguous suffix match such as `trp-infra` matching `olxbr/trp-infra`; if still ambiguous or missing, stop and ask the user to choose one of the active write target project names.
6. Finds the requested task id in the unified plan.md (all tasks for all repos live in one plan).
7. If `{project}` was not provided and the task id is unambiguous, delegates to `@j.implementer`.
8. If `{project}` was not provided and the task targets multiple repos or is ambiguous, stop and ask the user to rerun with `--project <project>` or `<project>:<feature-slug>/task<id>`; do not guess.
9. If the task has dependencies, `@j.implementer` must verify those dependencies are COMPLETE before editing.
10. The task still uses the normal READ→ACT→STATE→COMMIT→VALIDATE loop and must read the full `CONTEXT.md` from workspace before source files.
11. All traceability artifacts live in the **workspace root** (not the target repo):
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/tasks/task-{id}/execution-state.md`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/tasks/task-{id}/validator-work.md`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/tasks/task-{id}/retry-state.json`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/tasks/task-{id}/runtime.json`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/sessions/{sessionID}-runtime.json`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/implementer-work.md`
    - `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/integration-state.json`
12. The task creates exactly one implementation commit directly on the canonical branch `feature/{feature-slug}` in the resolved target repo.
13. The command must not create a second/final commit for state artifacts. Leave feature state changes for `/j.unify`, gated by `workflow.unify.commitFeatureArtifacts`.
14. The command exits after the requested target task is COMPLETE, FAILED, or BLOCKED. It must not continue into sibling tasks, later waves, or other write targets.

## Delegation Rule (MANDATORY)

You MUST delegate this task to `@j.implementer` using the `task()` tool.
Do NOT implement code yourself — you are the orchestrator, not the executor.

The delegated prompt MUST start with:

```
Execute task {id}
```

Include the exact task contract in the delegated prompt:

```
Execute task {id} for feature {feature-slug}.

Task-scoped invocation from /j.implement-task. Implement only this task and stop after COMPLETE, FAILED, or BLOCKED.

Target Project: {project}
Target Repo Root: {absolute repo root}
Plan: {absolute workspace path to plan.md}
Spec: {absolute workspace path to spec.md when present}
Context: {absolute workspace path to CONTEXT.md, required for active Juninho plans}

Task contract:
- featureSlug: {feature-slug}
- taskId: {id}
- targetProject: {project}
- targetRepoRoot: {absolute repo root}
- planPath: {absolute workspace path to plan.md}
- specPath: {absolute workspace path to spec.md when present}
- contextPath: {absolute workspace path to CONTEXT.md, required for active Juninho plans}
- taskStatePath: {absolute workspace path to state/tasks/task-{id}/execution-state.md}
- validatorWorkPath: {absolute workspace path to state/tasks/task-{id}/validator-work.md}
- retryStatePath: {absolute workspace path to state/tasks/task-{id}/retry-state.json}
- runtimePath: {absolute workspace path to state/tasks/task-{id}/runtime.json}
- sessionsDir: {absolute workspace path to state/sessions}
- implementerWorkPath: {absolute workspace path to state/implementer-work.md}
- integrationStatePath: {absolute workspace path to state/integration-state.json}
- taskFiles: {comma-separated absolute file paths resolved from the task Files section}
- activePlanPath: /Users/kleber.motta/repos/.opencode/state/active-plan.json
```

Every path in the delegated task contract MUST be absolute. Spec artifacts resolve from `$WORKSPACE_ROOT/docs/specs/{feature-slug}/`; task files resolve from `$TARGET_REPO_ROOT/`. Do not pass relative `docs/specs/...` paths to the subagent.

When ANY sub-agent returns output:
- NEVER dismiss it as incomplete or take over its job.
- Forward blockers, unknowns, or ambiguities to the user with the `question` tool when a decision is needed.
- If the task is COMPLETE, report the commit and state artifact paths.

## After task implementation

Use `/j.implement-task <project>:<feature-slug>/task<next-id>` for the next focused task when the active plan has multiple write targets.
Run `/j.check` only when the intended task set or whole feature is ready for repo-wide verification.
