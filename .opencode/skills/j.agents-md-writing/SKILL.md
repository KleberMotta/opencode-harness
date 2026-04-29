---
name: j.agents-md-writing
description: Write strong AGENTS.md files with local rules, commands, and boundaries
---

# Skill: AGENTS.md Writing

## When this skill activates
Creating or editing any `AGENTS.md` file.

## Goal
Write an agent-facing operating manual for the current directory only.

## Required Sections
- Project or directory purpose
- Build, lint, and test commands that actually work here
- File layout and ownership boundaries
- Local coding conventions and pitfalls
- Review and verification expectations

## Rules
- Keep the root `AGENTS.md` concise and high-signal
- Make nested `AGENTS.md` files additive, not repetitive
- Prefer concrete commands over vague guidance
- Separate business rules from technical principles:
  - `AGENTS.md` = how to work in this area
  - `docs/domain/*` = business behavior
  - `docs/principles/*` = cross-cutting technical patterns

## Good patterns
- Include exact commands such as `npm test -- foo` or `./gradlew test --tests "..."`
- Call out invariants, ownership boundaries, and high-blast-radius files
- Mention generated files, migrations, or release steps when relevant

## Anti-patterns
- Dumping generic style advice with no repository specifics
- Repeating the same commands in every nested file
- Mixing business flows into technical instructions
- Writing aspirational rules that are not enforced anywhere
