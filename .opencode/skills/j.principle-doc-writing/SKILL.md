---
name: j.principle-doc-writing
description: Write technical principle docs with rationale, rules, and examples
---

# Skill: Principle Doc Writing

## When this skill activates
Creating or editing files under `docs/principles/`.

## Goal
Capture cross-cutting engineering guidance that multiple modules should follow.

## Required Structure
- Problem this principle solves
- Rule set (do / avoid)
- Rationale and trade-offs
- Canonical examples in this repository
- Related files or tooling that enforce the rule

## Sync marker pattern
For generated sections, prefer a marker like:

`<!-- juninho:sync source=src/api/client.ts hash=def456 -->`

## Rules
- Keep principles technical, reusable, and stack-aware
- Reference concrete files or commands when possible
- Register or update the keyword mapping in `docs/principles/manifest`
- Distinguish principle docs from domain docs and `AGENTS.md`

## Anti-patterns
- Repeating business requirements here
- Writing slogans with no enforcement or examples
- Documenting obsolete patterns without marking them deprecated
