# /j.patch — Surgical edit of a historical commit on the active feature branch

Surgical, focused edit of a specific commit in the current feature branch's history. Use when a small inconsistency was missed inside an already-pushed commit and you want the fix to land **inside that commit** (instead of as a follow-up).

## Usage

```
/j.patch <commit-sha> <instruction>
```

## Examples

```
/j.patch 2077218 mover SellerIdentityData/SellerIdentityDeniedData/SellerIdentityImagesData para dentro do arquivo existente SellerEntityData.kt e deletar o arquivo separado SellerIdentityData.kt
/j.patch 40c9328 trocar Request.Options(connect=10s, read=60s, followRedirects=true) — followRedirects deve ser false
/j.patch a38d4b8 renomear SellerIdentityService.markPending → markSubmittedToProvider
```

## Constraints (MANDATORY)

The orchestrator MUST refuse the command and ask the user to resolve before continuing if any of these are true:

1. `<commit-sha>` does not exist in the current branch history (`git cat-file -e <sha>^{commit}` fails).
2. `<commit-sha>` is **not** an ancestor of `HEAD` (`git merge-base --is-ancestor <sha> HEAD` fails).
3. `<commit-sha>` is on the trunk branch (`main`/`master`/`trunk`/`develop`) — never patch shared history.
4. The working tree is dirty (`git status --porcelain` returns non-empty). Stash or commit first.
5. The branch is currently in a rebase/merge/cherry-pick (`.git/rebase-merge` or `.git/rebase-apply` or `.git/MERGE_HEAD` exists).
6. The PR for this branch is already merged (best-effort check via `gh pr view --json state` if `gh` is available).

If any guard trips, stop and explain to the user. Do not proceed.

## What happens

The orchestrator MUST execute these steps in order, in the target repo (the one containing the SHA), using the `bash` tool with absolute working directory:

### Phase 1 — Safety

1. Run the 6 guards above. Abort with a clear message on any failure.
2. Capture the current branch name: `git symbolic-ref --quiet --short HEAD`.
3. Create a backup branch: `git branch backup/pre-patch-<short-sha>-<timestamp> <current-branch>`. Print the backup name to the user so they can recover.

### Phase 2 — Rebase to the target commit

4. Resolve the user-provided SHA to its **full 40-char form** with `git rev-parse <commit-sha>` and use it everywhere downstream. This eliminates ambiguity when two short SHAs share a prefix.

5. Write a one-shot `GIT_SEQUENCE_EDITOR` script that turns ONLY the target SHA's `pick` line into `edit` (leaving every other commit as `pick`). The git rebase TODO uses 7-char short SHAs by default, so match the first 7 chars of the resolved full SHA followed by `[a-f0-9]*` to handle longer expansions:
   ```sh
   #!/bin/sh
   # SHORT_SHA must be exported by the caller before running git rebase.
   sed -i.bak "s/^pick \\(${SHORT_SHA}[a-f0-9]*\\) /edit \\1 /" "$1"
   ```
   Pass `SHORT_SHA` (first 7 chars of the resolved full SHA) via the environment when invoking the rebase:
   ```sh
   FULL_SHA=$(git rev-parse <commit-sha>)
   export SHORT_SHA=$(echo "$FULL_SHA" | cut -c1-7)
   GIT_SEQUENCE_EDITOR=/tmp/edit-todo-$$.sh \
     git rebase -i ${FULL_SHA}^
   ```

6. Run the rebase command from step 5.

7. Verify rebase paused on the right commit: `git log -1 --format=%H` should equal `$FULL_SHA`.

### Phase 3 — Apply the instruction

8. Read the user's `<instruction>`. Determine the file edits needed using `read`, `glob`, `grep` tools to inspect the current state.
9. Apply edits with `edit`/`write` tools. Use `git mv`/`git rm` via `bash` for moves/deletes.
10. Run a quick build/compile check appropriate to the stack to catch trivial breakage:
    - Maven: `./mvnw -q compile test-compile` (Java/Kotlin)
    - Node: `npm run typecheck` if the script exists, else skip
    - Terraform: `terraform fmt -check && terraform validate`
    If the check fails, stop, run `git rebase --abort`, restore from backup if needed, and report the failure to the user.
11. Stage everything: `git add -A`.
12. Amend the commit preserving the original message: `git commit --amend --no-edit --no-verify`.

### Phase 4 — Replay remaining commits

13. Run `git rebase --continue`.
14. If the rebase pauses for a conflict in a later commit, do NOT auto-resolve. Stop, leave the rebase paused, and report the conflicting file(s) and commit to the user with instructions:
    ```
    Rebase paused on commit <sha-N>. Conflicts in:
      - <file1>
      - <file2>

    Resolve manually, then run:
      git add -A && git rebase --continue

    Or to abort and restore:
      git rebase --abort
      git checkout backup/pre-patch-<short-sha>-<timestamp>
    ```
15. Once the rebase completes, verify the new history with `git log --oneline -<original-count>` and report the new SHA of the patched commit (the SHAs of all commits after it will also have changed).

### Phase 5 — Validation

16. Run a fast smoke test scoped to the patched files when possible:
    - Maven: `./mvnw -q test -Dtest=<test-classes>` for tests touching the changed files (use `grep` to find them); else `./mvnw -q compile`.
    - Node: nearest test file via `npx jest --findRelatedTests <files>` if available.
    - Terraform: `terraform validate`.
    Report the result. If the smoke fails, do NOT auto-revert — leave the new history in place and ask the user how to proceed.

### Phase 6 — Push

17. **Do NOT auto-push.** Print the exact command the user should run, e.g.:
    ```
    git push --force-with-lease
    ```
    Explain that:
    - The original SHAs in the PR are now invalidated.
    - Inline review comments anchored to old SHAs will appear as "outdated" in the PR.
    - CI will re-run from the new history.

## Output format

After success, print a structured summary:

```
✅ Patch applied to <original-short-sha>
   Original SHA:  <original-full-sha>
   New SHA:       <new-full-sha>
   Backup branch: backup/pre-patch-<short-sha>-<timestamp>
   Files changed: <N files>
   Commits replayed: <count> (no conflicts | conflicts at <sha-N>)
   Build check:   PASS | FAIL
   Smoke test:    PASS | FAIL | SKIPPED

Next step: git push --force-with-lease
```

## Anti-patterns to refuse

- **Do not** patch a commit on `main`/`master`/`trunk`/`develop`.
- **Do not** force-push without the user explicitly running the command.
- **Do not** silently squash, reorder, or split commits — `/j.patch` is for amending one commit's content only.
- **Do not** auto-resolve merge conflicts during the replay — always stop and hand control back.
- **Do not** skip the backup branch step.
- **Do not** delete the backup branch when finished — leave it for the user to clean up.

## When NOT to use this command

- When the fix is **across multiple commits** — use `git rebase -i` manually with multiple `edit`/`fixup`/`squash` in one shot.
- When the fix should be a **new commit on top** (the natural git workflow) — just commit normally.
- When the commit is already on a shared/protected branch — open a new PR with the fix.
- When the working tree is dirty — clean it first.

## Skills

- `j.shell-script-writing` — for the GIT_SEQUENCE_EDITOR helper and guard logic.

## Notes for the orchestrator

- This command is **synchronous** (the user is waiting). Do not delegate to a long-running agent.
- All commands run with the **target repo's absolute path** as `workdir` — never `cd` chains.
- Use the `bash` tool for git operations. Use `read`/`edit`/`write`/`glob`/`grep` for content changes.
- The user typed the instruction in their natural language — interpret it as a concrete change. If ambiguous, ask one clarifying question via the `question` tool **before** entering Phase 2 (because rebase is harder to back out of after it starts).
