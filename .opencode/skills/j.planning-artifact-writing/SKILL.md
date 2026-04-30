---
name: j.planning-artifact-writing
description: Write Juninho spec, CONTEXT, and plan artifacts that preserve research findings, business intent, ambiguity decisions, and implementation constraints across agents
---

# Skill: Planning Artifact Writing

## When this skill activates
Creating or editing `docs/specs/**/spec.md`, `docs/specs/**/CONTEXT.md`, `docs/specs/**/plan.md`, or harness prompts that govern `/j.spec`, `/j.plan`, `/j.implement`, or `/j.validator` artifact flow.

## Required Steps
- Treat `CONTEXT.md` as a required companion artifact for every spec or plan, not an optional note file.
- Capture durable research findings in `CONTEXT.md`: explored files, discovered patterns, business vocabulary, identifier mappings, existing constraints, integration contracts, local test/build policy, and unknowns resolved by the developer.
- Keep `spec.md` focused on behavior and acceptance criteria; keep codebase-specific evidence and rationale in `CONTEXT.md` so planning and implementation do not re-discover or reinterpret it.
- When planning, read existing `CONTEXT.md` before new exploration; append or refine context instead of replacing useful prior discoveries.
- Make `plan.md` executable without architectural guessing: exact files, exact patterns to follow, exact identifiers/field mappings, exact forbidden approaches, exact verification commands, explicit context/spec references, and explicit done criteria.
- Use the canonical Markdown plan contract for all `plan.md` artifacts. Do not write tag-based `plan.md` artifacts.
- Treat `plan.md` plus `CONTEXT.md` as a compiler input for generated implementation. If an implementer would need to ask what a task means, the plan is incomplete.
- For medium/high complexity tasks, write detailed task actions with concrete class/function names, selected behavior from reference projects, allowed/forbidden calls, error mappings, transaction boundaries, tests, and exact verification commands.
- For runtime/integration coverage, prefer local Python validation scripts in the target repo's `scripts/` directory. Plan one task to create/update the script and a later `j.validator` task to execute the exact `python3 scripts/...` command; do not default to traditional integration test classes unless the repo context explicitly requires them.
- If any task has room for multiple plausible interpretations, either encode the chosen interpretation in `CONTEXT.md` and the task Action section, or ask the developer before writing/approving the plan.
- Implementation and validation prompts must require reading the full `CONTEXT.md` alongside `spec.md` and `plan.md` before code.

## Anti-patterns to avoid
- Writing a spec without `CONTEXT.md`.
- Re-running planning research as if no spec context exists.
- Using vague task actions like "implement service layer" or "wire client" without naming files, patterns, fields, and error semantics.
- Referring to reference behavior as "same as X" without expanding which methods/rules are in scope and which are explicitly excluded.
- Leaving identifier mappings implicit, especially when header/body/entity/provider names differ.
- Letting plan-reviewer approve tasks that require implementers to infer business intent or choose between competing patterns.
- Treating `CONTEXT.md` as historical scratchpad; it must be the current source of research truth.
- **Creating separate tasks for unit tests of code implemented in an earlier task.** The pre-commit hook runs related tests derived from staged file names — if the test is in a later task, the hook passes silently with zero coverage. Unit tests MUST be in the same task as the implementation they cover. Standalone test tasks are acceptable only for integration/controller tests requiring additional infrastructure.
- Including untested curls/commands in PR descriptions with placeholder values that break when copied literally.

## PR Description Functional Tests — Local Validation Rule

When the plan task that produces the PR description includes a "Functional Tests" section:

1. **Validate before committing**: run each curl/command locally, confirm the expected response, and iterate until all pass. The PR description is not done until the curls work.
2. **No placeholders**: curls must use real example values (UUIDs, IDs) validated locally — never `{id}`, `<token>`, or template syntax that fails when copy-pasted.
3. **Document prerequisites** the reviewer needs to reproduce locally (localstack topics/queues, mock principals in `.env.development`, seed data setup, manual steps).
4. **If validation reveals missing infrastructure** (topics, principals, seed), fix it first — then re-run the curl and confirm success before writing it into the PR.
5. **Copy-paste-ready**: a reviewer copies the curl block, runs it, gets the documented response — zero edits required.

## Recommended CONTEXT.md Sections
- Goal
- Research Findings
- Business Vocabulary and Identifier Mapping
- Existing Code Patterns To Reuse
- Integration Contracts
- Data and Persistence Constraints
- Test and Build Policy
- Decisions Made
- Anti-Patterns to Avoid
- Key Files
- Open Questions / Resolved Unknowns

## Canonical Artifact Contract
- `docs/specs/{feature-slug}/spec.md`: behavior contract approved by the developer.
- `docs/specs/{feature-slug}/CONTEXT.md`: durable research and intent memory shared by spec, plan, implementer, validator, checker, and unify.
- `docs/specs/{feature-slug}/plan.md`: ambiguity-free Markdown execution contract with exact task boundaries, context references, and detailed implementation instructions.
