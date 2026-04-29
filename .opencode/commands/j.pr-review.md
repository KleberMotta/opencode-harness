# /pr-review — Advisory PR Review

Launch the `@j.reviewer` agent to perform an advisory code review on the current branch diff.

## Usage

```
/j.pr-review
```

## What happens

1. `@j.reviewer` reads all files changed in the current branch (vs main)
2. Reviews for: bugs, edge cases, intent drift, business-rule risk, clarity, security, performance, maintainability
3. Returns a structured report: Critical / Important / Minor / Positive Notes / Intent Coverage / Domain Rule Risks
4. Report is **advisory only** — does not block any merge or pipeline step

## When to use

- After `/j.unify` creates the PR, before human review
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
