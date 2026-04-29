---
name: skill-creator
description: Create new skills, refine existing skills, and define skill eval scenarios. Use whenever the task involves authoring or improving `.opencode/skills/*`, expanding `skill-map.json`, or strengthening skill-trigger and skill-effect evals.
---

# Skill Creator

Use this skill when working on the harness skill system itself.

## When this skill activates
- Creating a new skill under `.opencode/skills/`
- Editing an existing `SKILL.md`
- Updating `.opencode/skill-map.json`
- Strengthening evals that must prove a skill triggers and changes agent behavior

## Required Steps
1. Define the intended trigger surface in the skill description, not only in the body.
2. Make the skill description explicit enough that the agent will consult it in realistic user prompts.
3. Add or update at least 2 realistic trigger eval prompts and at least 2 near-miss non-trigger prompts when changing a skill's description or scope.
4. Add at least one behavioral eval that proves the skill changes agent behavior, not only that the file exists.
5. Prefer narrow, reusable resources inside the skill directory when instructions grow beyond a compact `SKILL.md`.

## Anti-patterns to avoid
- Writing a skill with a vague description that under-triggers.
- Declaring a skill complete without a trigger eval and a behavior-change eval.
- Stuffing workflow-specific examples into the description instead of trigger criteria.
- Expanding `skill-map.json` without adding a scenario that proves the mapping works.
