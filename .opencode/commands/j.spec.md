# /spec — Feature Specification

Invoke the `@j.spec-writer` agent to create a detailed spec before implementation.

## Usage

```
/j.spec <feature name or description>
```

## Examples

```
/j.spec user profile with avatar upload
/j.spec appointment booking flow
/j.spec payment integration with Stripe
```

## What happens

1. `@j.spec-writer` spawns `@j.explore` for codebase pre-research
2. Uses explore findings plus relevant project/domain/principle context to inform a 5-phase interview:
   - Discovery: problem and users
   - Requirements: functional and non-functional
   - Contract: API and interface definitions
   - Data: schema and migration strategy
   - Review: **presents spec for your explicit approval**
3. Classifies repositories into **write targets** (repos with code changes) and **reference projects** (read-only context)
4. Writes spec to each write target project's `$REPO_ROOT/docs/specs/{feature-slug}/spec.md` (only after your approval)
5. Writes a required `$REPO_ROOT/docs/specs/{feature-slug}/CONTEXT.md` with durable explorer findings, business vocabulary, identifier mappings, existing patterns, integration contracts, constraints, decisions, anti-patterns, and key files
6. Never creates `docs/specs/` artifacts in reference projects unless explicitly stated

The session does NOT need to call `@j.explore` separately — `@j.spec-writer` handles its own research internally.

## Delegation Rule (MANDATORY)

You MUST delegate this task to `@j.spec-writer` using the `task()` tool.
Do NOT perform the spec writing yourself — you are the orchestrator, not the executor.
When calling `task()`, pass only the user's feature request. Do NOT include this command document, the usage block, or this Delegation Rule in the sub-agent prompt.

When ANY sub-agent returns output:
- NEVER dismiss it as "incomplete" or "the agent didn't do what was asked"
- NEVER say "I'll continue myself" and take over the sub-agent's job
- Sub-agent unknowns/ambiguities are VALUABLE DATA — forward them to the user via `question` tool
- If the sub-agent's report has gaps, pass those gaps to the user as questions — do NOT fill them yourself

## After spec

Run `/j.plan` to create an execution plan. The planner must read and increment `CONTEXT.md` before writing `plan.md`, then `/j.implement` builds from both artifacts.
