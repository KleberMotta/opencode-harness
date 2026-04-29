# /pr-review — Advisory PR Review

Launch the `@j.reviewer` agent to perform an advisory code review on the current branch diff.

## Usage

```
/j.pr-review                # iterate writeTargets[] from active-plan.json
/j.pr-review <repo-path>    # review a single explicit project
```

## Resolution

If `<repo-path>` is provided, review only that project's branch diff.

Otherwise:
1. Read `.opencode/state/active-plan.json`
2. For every `writeTargets[].targetRepoRoot`, run a separate review against that project's `feature/{slug}` branch vs. its base (typically `main`)
3. Each review is independent — do **not** merge diffs across projects (different remotes, different histories)

## What happens (per target)

Invoke `@j.reviewer` with explicit project context. The reviewer must run all `git diff` / `git log` commands via the Bash tool with `workdir="$REPO_ROOT"` so the diff comes from the target project's git, not the workspace.

1. Reviewer reads all files changed in the target project's branch (vs. base)
2. Reviews for: bugs, edge cases, intent drift, business-rule risk, clarity, security, performance, maintainability
3. Returns a structured report per target: Critical / Important / Minor / Positive Notes / Intent Coverage / Domain Rule Risks
4. Reports are **advisory only** — do not block any merge or pipeline step

## When to use

- After `/j.unify` creates the PRs, before human review
- When you want a second opinion on the implementation quality
- For pre-merge quality assurance

## Distinction from @j.validator

| `@j.reviewer` | `@j.validator` |
|---|---|
| Post-PR, advisory | During implementation loop |
| "Is this good code?" | "Does this satisfy the spec?" |
| Never blocks | Gates the pipeline |
| Read-only | Can fix issues directly |

## Quality target

Aim for PR artifacts with the same quality bar as a strong human-authored engineering PR:
- state the purpose and problem clearly
- summarize the solution in reviewer-friendly steps
- map changed files to responsibilities
- provide runnable validation steps with expected outcomes
