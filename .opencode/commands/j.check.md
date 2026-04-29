# /check — Run All Quality Gates

Invoke the `@j.checker` agent to run the full repository verification after `@j.implementer` exits, then perform a detailed PR-style review pass.

## Usage

```
/j.check
/j.check <repo-path>
```

## Examples

```
/j.check
/j.check /Users/kleber.motta/repos/olxbr/trp-seller-api
```

## What runs

1. If a repo path or plan/spec/context path is provided, that explicit target takes precedence over the workspace `.opencode/state/active-plan.json`.
2. `@j.checker` reads the resolved `.opencode/state/active-plan.json` to discover all write targets
3. `@j.checker` runs `.opencode/scripts/check-all.sh`, which iterates every target repo from the active multi-project plan
4. For each write target (`$REPO_ROOT`), `@j.checker` reads `$REPO_ROOT/docs/specs/{feature-slug}/CONTEXT.md` and `$REPO_ROOT/docs/specs/{feature-slug}/state/functional-validation-plan.md` when it exists
5. `@j.checker` delegates a detailed read-only multi-pass review to `@j.reviewer` covering all write targets

This script is expected to run the repository-wide checks for the current stack.
Typical examples:
- `npm run typecheck && npm run lint && npm test`
- `./gradlew ktlintCheck && ./gradlew compileKotlin compileTestKotlin && ./gradlew test`
- `./mvnw spotless:check && ./mvnw -DskipTests compile test-compile && ./mvnw test`

The review pass must inspect the resulting integrated branch like a real PR review and look for:
- bugs and missed edge cases
- spec or plan intent drift
- business-rule/domain-rule violations
- project pattern or AGENTS violations
- unnecessary complexity, over-engineering, abstraction inflation, or code bloat
- maintainability or safety concerns worth correcting before closeout

The review must be performed in multiple passes, not one shallow pass:
- Pass 1: correctness, bugs, edge cases, failure paths
- Pass 2: spec/plan/domain/rule alignment and runtime blind spots
- Pass 3: project patterns, simplicity, bloat, and maintainability

If a feature slug is active, persist the report to each write target:
- `$REPO_ROOT/docs/specs/{feature-slug}/state/check-review.md`

Operational rule:
- delegate the review to `@j.reviewer`
- provide `CONTEXT.md` to the reviewer as the durable business/research intent source
- provide `functional-validation-plan.md` to the reviewer when it exists
- persist the full verification transcript to `docs/specs/{feature-slug}/state/check-all-output.txt`
- then write the returned markdown review to `docs/specs/{feature-slug}/state/check-review.md`
- then summarize whether the repository is blocked by failing checks, review findings, or both

The report should contain Critical / Important / Minor findings plus intent-coverage and domain-risk sections.
The persisted `check-review.md` must also contain a `## Reentry Contract` section with exact artifact paths and the expected next action for `/j.implement`.

If `check-all.sh` fails, still produce the review report when enough context exists. The report should mention whether failures came from verification, code review findings, or both.
If `functional-validation-plan.md` exists, the review must also call out runtime or integration risks that remain unproven or unsupported by the current implementation.

## When to use

- After `/j.implement` returns control to the caller
- Before `/j.unify`
- After a refactor that touched many files or workflows

## Notes

This is intentionally broader than the pre-commit hook.
The pre-commit hook stays fast and runs synchronous, blocking gates for structure lint, build verification, and tests related to staged files.

If the check script fails or the review report contains Critical or Important findings, invoke `/j.implement` again with:
- the failing verification output
- the path to `docs/specs/{feature-slug}/state/check-review.md`
- the path to `docs/specs/{feature-slug}/state/check-all-output.txt`
- the path to `docs/specs/{feature-slug}/state/functional-validation-plan.md` when it exists

Forward-only correction rule:
- if a required correction targets work from a task already marked COMPLETE, create a new follow-up task instead of reopening the completed task
- `check-review.md` should make that explicit when it applies

`@j.implementer` must treat that review report as actionable correction input for the next pass.
`@j.implementer` must also treat `functional-validation-plan.md` as the validation contract for the next `/j.check` pass.

## Delegation Rule (MANDATORY)

You MUST delegate this command to `@j.checker` using the `task()` tool.
Do NOT run the full `/j.check` logic yourself — you are the orchestrator, not the checker.

`@j.checker` is responsible for running `.opencode/scripts/check-all.sh`, invoking `@j.reviewer`, and persisting `check-review.md`.

When ANY sub-agent returns output:
- NEVER dismiss it as "incomplete" or "the agent didn't do what was asked"
- NEVER say "I'll continue myself" and take over the sub-agent's job
- If the checker or reviewer needs more context, provide that context and re-delegate
- If checks or review findings block progress, route the result back into `/j.implement` with the generated artifacts
