# /j.learn — Governed self-improvement of the harness (weakness mining → minimal proposal → regression gate → human approval → audit trail)

Turn one **observed failure** of the harness into one **minimal, falsifiable, human-approved** change to exactly one harness surface, with a permanent audit record. This is the Self-Harness pattern: the harness never mutates itself silently, never mutates on speculation, and never mutates without a regression gate.

## Usage

```
/j.learn <description of the observed failure or the dev's correction> [--surface <path>] [--dry-run]
```

- `--surface <path>` — pin the target surface up front (skips surface selection, but the surface-fit rules below still apply and can veto the pin).
- `--dry-run` — run phases 1–4 and print the audit record + diff, but never apply anything and never write the record file.

## Examples

```
/j.learn o implementer criou DTO com data class mutável de novo; dev corrigiu em PR #91 (diff anexo)
/j.learn check-review.md apontou 3x "missing @Transactional em service que escreve" — checker não pega
/j.learn --surface .opencode/plugins/j.comment-checker.ts plugin deixou passar comentário-narração em bloco kdoc
/j.learn --dry-run o unify propôs promover conhecimento errado para o AGENTS.md do contexto
```

## Constraints (MANDATORY)

The orchestrator MUST refuse the command and stop if any of these are true:

1. **No concrete evidence.** The description does not come with (or point to) at least one verifiable artifact: a diff of the dev's correction, an excerpt from a `check-review.md`, or a session trace/log. A proposal without a failure pattern is rejected — "proposta sem failure pattern é rejeitada".
2. **More than one root mechanism.** If the evidence shows two independent failure mechanisms, refuse and ask the user to run `/j.learn` once per mechanism.
3. **The proposal would touch more than one surface.** Exactly 1 failure → exactly 1 surface. No bundled edits.
4. **The working tree of the harness repo is dirty on the files the proposal would touch.** Ask the user to commit/stash first so the diff and rollback are clean.
5. **The change is not falsifiable.** No existing eval covers it AND no new test is being proposed alongside it.

If any guard trips, stop and explain to the user. Do not proceed.

## What happens

The orchestrator MUST execute these phases in order. This command is **synchronous** (the user is waiting) — do not delegate to a long-running agent.

### Phase 1 — Weakness signature

1. Classify the failure by its **root mechanism**, not its symptom. "Agent wrote a mutable DTO" is a symptom; the mechanism might be "skill j.dto-writing never states immutability as a hard rule" or "no lint rule catches `var` in data classes".
2. Collect the concrete evidence and record it verbatim (file path + excerpt, PR diff hunk, check-review section, session trace snippet). Evidence is mandatory (Constraint 1).
3. Write the weakness signature: one sentence naming the mechanism, plus the evidence pointers.

### Phase 2 — Surface selection

4. The named surfaces of the harness are, exhaustively:
   - `.opencode/agents/*.md` — agent prompts
   - `.opencode/commands/*.md` — command specs
   - `.opencode/plugins/*.ts` — runtime policy/enforcement
   - `.opencode/scripts/*.sh` — shell gates (lint/build/test)
   - skills — workspace (`.opencode/skills/`) or context layer (`{context}/agent-context/skills/`)
   - `skill-map.json` — workspace or context layer
   - `{context}/agent-context/AGENTS.md` — context-scoped agent knowledge
   - `{context}/agent-context/lint-rules/` — context-scoped detekt/lint rules
5. Pick **exactly one** surface using these rules, in priority order:
   - If the failure is **mechanically detectable in code** → prefer a detekt/lint rule in the context layer (`{context}/agent-context/lint-rules/`) over prose. A rule fires every time; prose is advisory.
   - If the failure is **agent behavior at runtime** (tool misuse, skipped step, forbidden action) → a plugin/policy (`.opencode/plugins/*.ts`).
   - Otherwise (knowledge/convention gaps) → a skill or the context `AGENTS.md`.
6. If `--surface` was given, validate the pin against these rules. If the pin contradicts them (e.g. pinning prose for a lintable failure), tell the user why and ask before continuing.

### Phase 3 — Minimal proposal + audit record

7. Draft the **minimal** change that removes the failure mechanism. Minimal means: smallest diff, no drive-by refactors, no "while we're here" edits.
8. Write the **change contract** BEFORE applying anything, with all fields:
   - `surface` — the one file/dir being changed
   - `failure_mechanism` — the weakness signature from Phase 1
   - `evidence` — verbatim pointers/excerpts
   - `expected_effect` — what observable behavior changes
   - `preserved_invariants` — what must NOT change (adjacent behaviors, pinned prompt phrases, existing eval expectations)
   - `falsifying_eval` — which existing eval/test would detect a regression or prove the effect; if none exists, the new test being added
   - `rollback` — exact revert step (usually `git revert`/restore of the one surface)

### Phase 4 — Regression gate

9. Run the full deterministic suite:
   ```
   cd /Users/kleber.motta/repos && TMPDIR=/Users/kleber.motta/repos/tmp npm run eval
   ```
   (57+ tests; must stay green.)
10. If the surface is a **plugin, carl, runtime, or skill**, also run the matching behavioral impact suite (these need `~/.opencode/bin` on PATH):
    ```
    npm run eval:behavioral:impact:carl      # carl injection
    npm run eval:behavioral:impact:runtime   # task runtime / task board
    npm run eval:behavioral:impact:workflow  # implement/check/unify loop
    npm run eval:behavioral:impact:tools     # tool-facing plugins
    ```
11. **Any regression → reject the proposal and report.** Do not iterate the proposal to "make the tests pass" — a regression means the change was not minimal or broke a preserved invariant.
12. If **no existing eval covers the change**, the proposal MUST include a new test that fails before the change and passes after. Otherwise reject as non-falsifiable (Constraint 5).
13. With `--dry-run`: print the audit record, the diff, and the eval results, then stop here.

### Phase 5 — Human approval

14. Present to the dev via the `question` tool: the full change contract + the concrete diff + the eval results. Ask for explicit approval.
15. Apply the change **only after explicit approval**. Never auto-apply. "The evals are green" is not approval.
16. **Security/permission rule (final, non-negotiable):** changes touching permissions or security surfaces — `opencode.json` permissions, `j.env-protection` — always require explicit human approval, **even in nonInteractive mode**. If the session is nonInteractive and the surface is security-related, stop and leave the proposal as pending.

### Phase 6 — Record

17. Write the audit record to `docs/harness-changes/NNN-<slug>.md`, where `NNN` is the next sequential number (zero-padded, e.g. `001`, `002`) and `<slug>` is a short kebab-case name for the change.
18. The record contains: the complete change contract, the eval results (full suite + impact suites run), and the decision (approved/rejected/pending, by whom, when).
19. Rejected and dry-run proposals may also be recorded (decision: rejected/dry-run) when the analysis is worth keeping — rejection evidence prevents re-proposing the same bad idea.

## Output format

After completion, print a structured summary:

```
/j.learn result
   Mechanism:   <one-line weakness signature>
   Surface:     <single surface path>
   Evals:       full=PASS|FAIL  impact=<suite>=PASS|FAIL|SKIPPED
   Decision:    APPLIED | REJECTED (<reason>) | PENDING APPROVAL | DRY-RUN
   Record:      docs/harness-changes/NNN-<slug>.md | not written
   Rollback:    <exact command>
```

## Anti-patterns to refuse

- **Do not** propose without evidence — no failure pattern, no proposal.
- **Do not** touch 2+ surfaces in one run — split into multiple `/j.learn` invocations.
- **Do not** write prose (skill/AGENTS) for a failure that a lint rule can catch mechanically.
- **Do not** apply anything without running the evals first — green suite is a precondition, not a follow-up.
- **Do not** accept speculative "improvements" with no observed failure behind them — this command mutates the harness only in response to reality.

## When NOT to use this command

- The fix belongs to a **project** (product code), not to the harness — just fix the project.
- The change is a config toggle already exposed in `j.juninho-config` — set the config instead.
- You want a broad refactor of the harness — that is a planned change (spec/plan/implement), not a learning loop.

## Notes for the orchestrator

- This command is **synchronous**. Run everything with absolute paths in `/Users/kleber.motta/repos`; never rely on `cd` chains.
- Use `read`/`grep`/`glob` to inspect surfaces, `edit`/`write` to apply, `bash` for evals and git.
- **Model-specific caveat:** a rule validated under one model may not hold after `model:set` — when the model changes, recommend re-running the relevant `eval:behavioral:impact:*` suites to revalidate learned rules.
