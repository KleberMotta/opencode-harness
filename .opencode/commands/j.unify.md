# /unify — Close the Loop

Invoke the `@j.unify` agent to reconcile plan vs delivery and execute only the enabled closeout steps.

## Usage

```
/j.unify
```

## What happens

1. Read `juninho-config.json` (`workflow` section)
2. Read `.opencode/state/active-plan.json` to discover all write targets
3. Reconcile the unified `$WORKSPACE_ROOT/docs/specs/{feature-slug}/plan.md` vs actual git diff per target — mark tasks DONE/PARTIAL/SKIPPED
4. Run only the enabled closeout steps, such as:
   - reconcile `persistent-context.md`
   - reconcile `$REPO_ROOT/docs/domain/` or `$REPO_ROOT/docs/domain/INDEX.md` per target
   - cleanup integration bookkeeping using `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/integration-state.json`
   - create a PR (per target repo when applicable)
4. If PR creation is enabled, draft a rich PR body with purpose, problem, solution, changed files, and validation steps
5. Treat forward-only follow-up tasks created after `/j.check` as first-class delivery units when reconciling plan vs delivery
6. Use the latest `check-review.md` reentry contract, when present, to explain what was corrected before closeout

## When to use

After `@j.implementer` exits, `/j.check` passes, and `@j.validator` has approved the required work.
By this point, code must already be committed into `feature/{feature-slug}`.

## Prerequisites

- All tasks in `execution-state.md` should be marked complete
- All validator passes should return APPROVED or APPROVED_WITH_NOTES
- `gh` CLI must be authenticated (`gh auth login`)

## Note

UNIFY behavior is controlled by `juninho-config.json` under `workflow`.
If PR creation, doc updates, or feature artifact commits are disabled there, `@j.unify` should skip those steps and report what was intentionally not executed.
UNIFY is no longer responsible for first-time code integration.
UNIFY should avoid creating final synthetic code/doc commits; history should already reflect the planned task commits by the time `/j.unify` runs. The only optional commit is `docs/specs/{feature-slug}/state/**` artifacts when `workflow.unify.commitFeatureArtifacts` is `true`.
If review-driven follow-up tasks were added after completed work, UNIFY should report them as forward-only corrections, not reopened task ownership.
