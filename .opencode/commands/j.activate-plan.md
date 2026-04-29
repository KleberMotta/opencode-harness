# /activate-plan — Point The Harness At A Repo Plan

Update the active plan pointer using an explicit repository path or plan path.

## Usage

```
/j.activate-plan <repo-path>
/j.activate-plan <plan-path>
```

## Examples

```
/j.activate-plan /Users/kleber.motta/repos/olxbr/trp-seller-api
/j.activate-plan /Users/kleber.motta/repos/olxbr/trp-seller-api/docs/specs/seller-entity/plan.md
```

## What happens

1. Runs `.opencode/scripts/activate-plan.sh` with the provided path.
2. Resolves the target repo root.
3. Finds the matching `docs/specs/{slug}/plan.md`.
4. Writes the resolved plan contract to the target repo's `.opencode/state/active-plan.json`.
5. Mirrors the same contract to the workspace `.opencode/state/active-plan.json` so plan-autoload, implement, and check all agree.

## Notes

- If the repo has multiple plans and you only pass the repo path, the script fails and tells you to pass the exact `plan.md`.
- Prefer this command whenever workspace state becomes stale or before running `/j.implement <repo-path>` or `/j.check <repo-path>` in a workspace.
