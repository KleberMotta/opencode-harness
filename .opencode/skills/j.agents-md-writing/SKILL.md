---
name: j.agents-md-writing
description: Write AGENTS.md files that stack as deltas in the directory-agents-injector chain, with real commands and directory-local rules
---

# Skill: AGENTS.md Writing

## When this skill activates
Creating or editing any `AGENTS.md` file.

## Required Steps

1. **Find your position in the injection stack before writing a word.**
   `.opencode/plugins/j.directory-agents-injector.ts` decides what the agent actually sees:
   - `findAgentsMdFiles(filePath, projectRoot)` starts at `path.dirname(filePath)` and walks up while `current !== projectRoot` — the loop is **exclusive**, so the project-root `AGENTS.md` is never injected by the plugin (its own comment: *root AGENTS.md is auto-loaded by OpenCode*).
   - `findContextAgentsMd` resolves every inherited `.context/AGENTS.md` and injects ancestor → nearest.
   - Nothing outside the project fires at all: the handler returns early unless `filePath.startsWith(directory)`.

   Effective order when a file is read:
   ```
   ancestor .context/AGENTS.md → nearest .context/AGENTS.md → repository AGENTS chain
   {project}/AGENTS.md                 → auto-loaded by OpenCode, not by the plugin
   {project}/src/AGENTS.md             → every ancestor dir that has an AGENTS.md
   {project}/src/.../{dir}/AGENTS.md   → the file's own directory, most specific
   ```

2. **Read every AGENTS.md already on that path.** For a file under `contexts/trp/trp-financial-api`, that includes inherited `.context/AGENTS.md`, repo root `AGENTS.md`, and nested `src/.../AGENTS.md`. Your file carries only the delta.

3. **Use the section set for your level.** Measured from `contexts/trp/trp-financial-api`:

   | Level | Sections |
   |---|---|
   | Root (`AGENTS.md`) | `Purpose`, `Core Commands`, `Layout`, `Working Rules`, `Verification Expectations` |
   | Nested (`src/**/AGENTS.md`) | `Purpose` (every one), `Boundaries` (only when the directory owns subpackages), `Local Rules`, `Pitfalls`, `Verification` |

   Only the root carries commands and layout. `Boundaries` appears in `.../domain/cashout/AGENTS.md` and `.../financial/security/AGENTS.md` because those own subpackages; `.../db/migration/AGENTS.md` omits it because it owns flat SQL files.

4. **Write only commands you ran in this repo.** The root file lists `make install`, `make package`, `make test`, `make lint`, `make apply-lint`, `./mvnw test -Dtest=ClassName`, `sh .opencode/scripts/check-all.sh` — each is a real target in that repo.

5. **Route the content to the right surface.**
   - `AGENTS.md` — how to work in this directory: boundaries, local rules, pitfalls, what to run.
   - `docs/domain/*` — business behavior (statuses, amounts, payloads, endpoints).
   - `docs/principles/*` — cross-cutting technical patterns shared by several modules.
   - inherited `.context/skills/*` — shared writing canon.

6. **Check the placement.** An `AGENTS.md` under `src/main/resources/` is copied byte-for-byte into `target/classes/` by the Maven build — `src/main/resources/AGENTS.md` and `target/classes/AGENTS.md` are identical files today, same for the `db/migration/` pair. Author under `src/`; never author or edit one under `target/`.

## Canonical Example

`contexts/trp/trp-financial-api/src/main/resources/db/migration/AGENTS.md` — complete, delta-only, one screen:

```markdown
# Flyway Migration Guide

## Purpose

This directory holds production schema and data migrations for the financial database.

## Local Rules

- Add new versioned files; do not rewrite applied migrations unless the change is coordinated and intentional.
- Keep migration names descriptive and tied to the tracked ticket or business change.
- Preserve audit tables, history tables, constraints, and financial identifiers when evolving ledger-related schemas.
- Put developer-only seed data in `src/main/resources/db/dev`, not here.

## Pitfalls

- Balance, order, cashout, and accounting tables feed async workflows, so schema changes can break runtime processing far from the migration itself.
- Constraint changes can invalidate assumptions in JPA mappings, specifications, and reporting queries.
- SQL formatting is enforced by Spotless, so inconsistent style will fail local checks.

## Verification

- Run `make lint` after editing migration SQL.
- Run the most relevant persistence or integration tests for the touched domain.
```

Read it against the root file it stacks under: it never restates the stack, the layout, or the command table. `make lint` reappears only to say *which* check this directory trips (Spotless on SQL) — that is a delta, not an echo.

Two more to read before writing your own:
- `contexts/trp/trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/cashout/AGENTS.md` — `Boundaries` used correctly (`configuration/`, `provider/`, `service/`).
- `contexts/trp/trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/security/AGENTS.md` — pitfalls written as blast radius (a broken principal mapping cascades into auditing).

## RED_LINES

- **Never restate a line an ancestor AGENTS.md already states.** Every ancestor is injected alongside your file, so a repeated rule is the same tokens twice with nothing added. In the canon, no nested file shares a single content line with the root — match that.
- **Never author an AGENTS.md under a build-output directory, and never edit one there.** `target/classes/AGENTS.md` and `target/test-classes/AGENTS.md` exist only because Maven copied them from `src/main/resources/`; edits there are erased by the next build, and reading a file under `target/` injects the stale copy.
- **Never write a command you have not run in this repo.** A wrong command in `Core Commands` gets executed verbatim by the next agent — an aspirational `npm test` in a Maven/Kotlin repo burns a full loop iteration before anything fails.
- **Never put business behavior in an AGENTS.md.** Statuses, amounts, payload fields, and endpoint contracts belong in `docs/domain/*`, which CARL injects by keyword. Buried in an AGENTS.md, they load only when someone happens to read a file in that exact directory.
- **Never let a nested AGENTS.md outgrow one screen.** Every nested file in the canon fits on one; the root is the only long file. A nested file that keeps growing is a domain doc or a principle doc wearing the wrong filename — move it.
- **Never write `Boundaries` for a directory with nothing to bound.** The section exists to name which subpackage owns what; with no subpackages it degrades into a file listing that goes stale on the next rename.
- **Never write a rule no one can check.** "Keep code clean" survives review and teaches nothing; "Keep adapters thin: controllers and listeners validate, log context, delegate once, and return" is checkable against the diff.

## Anti-patterns to avoid

- Generic style advice with no repository specifics — the file should be unusable in any other repo.
- Copying the parent's section skeleton and refilling it with paraphrases of the parent's rules.
- Listing files as `Layout` in a nested file; layout belongs to the root, and file lists rot.
- Writing `Purpose` as a restatement of the directory name ("This directory holds cashout files").
- Documenting intent ("we should migrate to X") instead of the current rule — AGENTS.md is operational, not a roadmap.
- A `Verification` section that says "run the tests" without naming which ones.

## Mimicry Test

Give an agent your new `AGENTS.md` plus every ancestor that would be injected with it, and a real task in that directory. The file passes if:

1. Deleting your file changes the agent's behavior — if the ancestors already produce the same result, your file is an echo, not a delta.
2. Every command in it runs green when pasted into a shell at the repo root.
3. An agent can name which subdirectory owns the change without opening the tree.
4. Nothing in the file would need editing if the business rules changed but the code structure did not — anything that would is domain content in the wrong place.
