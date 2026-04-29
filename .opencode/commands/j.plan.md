# /plan — Strategic Planning

Invoke the `@j.planner` agent to create an actionable plan from a goal.

## Usage

```
/j.plan <goal or task description>
```

## Examples

```
/j.plan add user authentication with email and Google OAuth
/j.plan fix the N+1 query bug in the appointments list
/j.plan refactor the service layer to use the repository pattern
```

## What happens

1. `@j.planner` classifies your intent
2. Reads any existing `spec.md` and required `CONTEXT.md` for the feature before new exploration
3. Explores the codebase for missing or stale context across all involved repositories
4. Uses project rules, domain docs, principle docs, and the existing `CONTEXT.md` before fixing the plan
4. Classifies repositories into **write targets** (repos with code changes) and **reference projects** (read-only context)
5. Interviews you (proportional to complexity)
6. Enriches `CONTEXT.md` with durable planning discoveries and writes `plan.md` into each write target project's `$REPO_ROOT/docs/specs/{feature-slug}/`
7. Writes `active-plan.json` with all `writeTargets` and their `targetRepoRoot` paths
8. Spawns `@j.plan-reviewer` for automated quality check
9. **Presents the plan to you for explicit approval**
10. Marks plan as ready for `/j.implement` (only after your approval)
11. If a later `/j.check` pass finds required changes after a task is already COMPLETE, the planner should express that work as a new follow-up task instead of reopening the completed one
12. The plan must spell out every ambiguous business/implementation decision in task text, especially identifier mappings, transaction boundaries, error semantics, integration contracts, and canonical patterns to follow

## Delegation Rule (MANDATORY)

You MUST delegate this task to `@j.planner` using the `task()` tool.
Do NOT perform the planning yourself — you are the orchestrator, not the executor.
When calling `task()`, pass only the user's planning goal. Do NOT include this command document, the usage block, or this Delegation Rule in the sub-agent prompt.

When ANY sub-agent returns output:
- NEVER dismiss it as "incomplete" or "the agent didn't do what was asked"
- NEVER say "I'll continue myself" and take over the sub-agent's job
- Sub-agent unknowns/ambiguities are VALUABLE DATA — forward them to the user via `question` tool
- If the sub-agent's report has gaps, pass those gaps to the user as questions — do NOT fill them yourself

## After planning

Run `/j.implement` to execute the plan, or `/j.spec` first for complex features.
