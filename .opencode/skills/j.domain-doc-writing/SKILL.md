---
name: j.domain-doc-writing
description: Write business-domain documentation that stays aligned with code
---

# Skill: Domain Doc Writing

## When this skill activates
Creating or editing files under `docs/domain/`.

## Goal
Document how the business domain works now, not how the code is implemented internally.

## Required Structure
- Domain summary
- Rules and invariants
- Inputs, outputs, and state transitions when relevant
- Edge cases and operational limits
- Source of truth references to the key code files

## Sync marker pattern
At the top of a generated or refreshed section, prefer a marker like:

`<!-- juninho:sync source=src/payments/service.ts hash=abc123 -->`

Use the marker to indicate which code file justified the current documentation.

## Rules
- Write in present tense
- Prefer user-visible behavior and business meaning
- Cite key files that justify each rule
- Update `docs/domain/INDEX.md` when adding or renaming a domain doc

## Anti-patterns
- Explaining framework internals instead of business behavior
- Copying raw code into the document
- Leaving undocumented edge cases discovered during implementation
