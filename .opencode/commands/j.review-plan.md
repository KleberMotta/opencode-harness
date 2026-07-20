# /review-plan — Independent canon review of the active plan

Invoke the `@j.canon-reviewer` agent (PLAN mode) to review the active `plan.md` against the canon,
in a session that is independent of the planner that produced it.

This command takes no arguments — the target is resolved from disk, exactly like the loop driver does.

## Usage

```
/j.review-plan
```

## What runs

1. Resolve the active feature `slug` from `.opencode/state/active-plan.json`.
2. Delegate to `@j.canon-reviewer` in **PLAN mode**, passing the absolute paths: `slug`, `plan.md`,
   `CONTEXT.md`, and the feature `state/` dir. Include `Stage: canon-review` in the delegation prompt
   so the runtime tags this session as the reviewer.

## Delegation Rule (MANDATORY)

You MUST delegate this command to `@j.canon-reviewer` using the `task()` tool. Do NOT run the
review yourself — you are the orchestrator, not the reviewer.

`@j.canon-reviewer` is responsible for reading `plan.md` + `CONTEXT.md` + the applicable SKILL/AGENTS
of the files cited under `### Files`, judging whether any step of the plan's "how" takes a shortcut
or contradicts the canon, writing the verdict to `docs/specs/{slug}/state/plan-review.json` (+ a short
`plan-review.md`), and — on FAIL — improving the canon (committed) and/or harness (uncommitted).

Archiving/replanning a rejected plan is the **loop driver's** job, never this command's and never
the reviewer's.
