---
name: j.shell-script-writing
description: Write robust shell automation for project workflows and hooks
---

# Skill: Shell Script Writing

## When this skill activates
Creating or editing shell scripts, especially in `.opencode/scripts/`, `scripts/`, or git hooks.

## Required Steps
1. Start with `#!/bin/sh` unless bash-only features are required
2. Use `set -e` and quote every variable expansion that can contain spaces
3. Resolve and `cd` to the project root before running project commands
4. Prefer delegating to project scripts (`npm run ...`, `make ...`, `./gradlew ...`) over embedding large command logic
5. Print short, actionable failure messages

## Preferred patterns
- Detect staged files once and reuse them
- Support project-specific overrides before framework defaults
- Keep hook scripts fast; full-suite checks belong outside the pre-commit path

## Anti-patterns
- Hardcoding one stack when multiple fallback commands are possible
- Running the full test suite inside pre-commit by default
- Using unquoted file lists or unsafe globbing
- Mixing environment bootstrapping with small hook utilities
