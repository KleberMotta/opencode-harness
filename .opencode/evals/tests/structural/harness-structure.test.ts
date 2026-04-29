import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { opencodeRoot, repoRoot } from "../../lib/test-utils"

describe("harness structural contracts", () => {
  test("core eval targets exist", () => {
    const root = repoRoot()
    const required = [
      ".opencode/scripts/pre-commit.sh",
      ".opencode/scripts/install-git-hooks.sh",
      ".opencode/hooks/pre-commit",
      ".opencode/skills/skill-creator/SKILL.md",
      ".opencode/scripts/check-all.sh",
      ".opencode/agents/j.checker.md",
      ".opencode/plugins/j.plan-autoload.ts",
      ".opencode/plugins/j.memory.ts",
      ".opencode/plugins/j.skill-inject.ts",
      ".opencode/plugins/j.directory-agents-injector.ts",
      ".opencode/plugins/j.task-runtime.ts",
      ".opencode/skill-map.json",
      "opencode.json",
    ]

    for (const relativePath of required) {
      expect(Bun.file(path.join(root, relativePath)).exists()).resolves.toBe(true)
    }
  })

  test("skill eval scenario docs exist for shared code-writing skills", () => {
    const root = repoRoot()
    const required = [
      ".opencode/evals/skills/j.mapper-writing.md",
      ".opencode/evals/skills/j.service-writing.md",
      ".opencode/evals/skills/j.repository-writing.md",
      ".opencode/evals/skills/j.controller-writing.md",
      ".opencode/evals/skills/j.dto-writing.md",
      ".opencode/evals/skills/j.listener-writing.md",
      ".opencode/evals/skills/j.configuration-writing.md",
      ".opencode/evals/skills/j.entity-writing.md",
      ".opencode/evals/skills/j.exception-writing.md",
      ".opencode/evals/skills/j.client-writing.md",
      ".opencode/evals/skills/j.model-writing.md",
      ".opencode/evals/skills/j.utility-writing.md",
    ]

    for (const relativePath of required) {
      expect(Bun.file(path.join(root, relativePath)).exists()).resolves.toBe(true)
    }
  })

  test("skill map entries point to existing skill folders", () => {
    const root = repoRoot()
    const map = JSON.parse(readFileSync(path.join(root, ".opencode", "skill-map.json"), "utf-8")) as Array<{
      pattern: string
      skill: string
    }>

    expect(map.length).toBeGreaterThan(0)
    for (const entry of map) {
      expect(entry.pattern.length).toBeGreaterThan(0)
      expect(Bun.file(path.join(root, ".opencode", "skills", entry.skill, "SKILL.md")).exists()).resolves.toBe(true)
    }
  })

  test("skill files use minimal expected frontmatter", () => {
    const root = opencodeRoot()
    const skillsDir = path.join(root, "skills")
    const skillDirs = Array.from(new Bun.Glob("*/SKILL.md").scanSync({ cwd: skillsDir }))

    expect(skillDirs.length).toBeGreaterThan(0)
    for (const relativePath of skillDirs) {
      const content = readFileSync(path.join(skillsDir, relativePath), "utf-8")
      expect(content.startsWith("---\nname:")).toBe(true)
      expect(content.includes("description:")).toBe(true)
      expect(content.includes("## When this skill activates")).toBe(true)
      expect(
        content.includes("## Required Steps") ||
          content.includes("## Required Sections") ||
          content.includes("## Required Structure") ||
          content.includes("## Rules")
      ).toBe(true)
      expect(
        content.includes("## Anti-patterns to avoid") || content.includes("## Anti-patterns")
      ).toBe(true)
    }
  })

  test("forward-only follow-up task rule stays documented across workflow stages", () => {
    const root = repoRoot()
    const files = [
      ".opencode/commands/j.plan.md",
      ".opencode/commands/j.implement.md",
      ".opencode/commands/j.check.md",
      ".opencode/commands/j.unify.md",
      ".opencode/agents/j.implementer.md",
      ".opencode/agents/j.planner.md",
      ".opencode/agents/j.checker.md",
      ".opencode/templates/spec-state-readme.md",
    ]

    for (const relativePath of files) {
      const content = readFileSync(path.join(root, relativePath), "utf-8")
      expect(content.toLowerCase()).toContain("follow-up task")
      expect(content.toLowerCase()).toContain("reopen")
    }
  })

  test("check review contract stays documented across checker, reviewer, implement, and unify", () => {
    const root = repoRoot()
    const files = [
      ".opencode/agents/j.checker.md",
      ".opencode/agents/j.reviewer.md",
      ".opencode/commands/j.check.md",
      ".opencode/commands/j.implement.md",
      ".opencode/commands/j.unify.md",
    ]

    for (const relativePath of files) {
      const content = readFileSync(path.join(root, relativePath), "utf-8")
      expect(content.includes("Reentry Contract") || content.includes("reentry contract")).toBe(true)
    }
  })

  test("artifact contracts stay documented across active workflow agents", () => {
    const root = repoRoot()
    const files = [
      ".opencode/agents/j.validator.md",
      ".opencode/agents/j.checker.md",
      ".opencode/agents/j.unify.md",
    ]

    for (const relativePath of files) {
      const content = readFileSync(path.join(root, relativePath), "utf-8")
      expect(content).toContain("Artifact Contract")
      expect(content).toContain("plan.md")
      expect(content).toContain("CONTEXT.md")
    }
  })

  test("runtime integration validation uses local python scripts", () => {
    const root = repoRoot()
    const planner = readFileSync(path.join(root, ".opencode/agents/j.planner.md"), "utf-8")
    const validator = readFileSync(path.join(root, ".opencode/agents/j.validator.md"), "utf-8")
    const reviewer = readFileSync(path.join(root, ".opencode/agents/j.plan-reviewer.md"), "utf-8")
    const planningSkill = readFileSync(
      path.join(root, ".opencode/skills/j.planning-artifact-writing/SKILL.md"),
      "utf-8"
    )

    for (const content of [planner, validator, reviewer, planningSkill]) {
      expect(content).toContain("scripts/")
      expect(content).toContain("python3 scripts/")
    }

    expect(planner).toContain("Local integration validation script rule")
    expect(validator).toContain("execute those exact `python3 scripts/...` commands")
    expect(reviewer).toContain("Integration validation uses local scripts")
  })

  test("spec and plan entrypoints cannot recurse into their worker agents", () => {
    const root = repoRoot()
    const contracts = [
      {
        command: ".opencode/commands/j.spec.md",
        entrypoint: ".opencode/agents/j.spec.md",
        worker: ".opencode/agents/j.spec-writer.md",
        workerAgent: "j.spec-writer",
      },
      {
        command: ".opencode/commands/j.plan.md",
        entrypoint: ".opencode/agents/j.plan.md",
        worker: ".opencode/agents/j.planner.md",
        workerAgent: "j.planner",
      },
    ]

    for (const contract of contracts) {
      const command = readFileSync(path.join(root, contract.command), "utf-8")
      const entrypoint = readFileSync(path.join(root, contract.entrypoint), "utf-8")
      const worker = readFileSync(path.join(root, contract.worker), "utf-8")

      expect(command).toContain("pass only the user's")
      expect(command).toContain("Do NOT include this command document")
      expect(entrypoint).toContain("Delegation Rule removed")
      expect(entrypoint).not.toContain("Pass the user's request verbatim")
      expect(worker).toContain("already the worker")
      expect(worker).toContain(`Do not delegate to \`${contract.workerAgent}\` again`)
    }
  })

  test("spec and plan agents use GPT 5.5", () => {
    const root = repoRoot()
    const agentFiles = [
      ".opencode/agents/j.spec.md",
      ".opencode/agents/j.spec-writer.md",
      ".opencode/agents/j.plan.md",
      ".opencode/agents/j.planner.md",
      ".opencode/agents/j.plan-reviewer.md",
    ]
    const config = JSON.parse(readFileSync(path.join(root, "opencode.json"), "utf-8")) as {
      agent: Record<string, { model: string }>
    }

    for (const relativePath of agentFiles) {
      const content = readFileSync(path.join(root, relativePath), "utf-8")
      expect(content).toContain("model: github-copilot/gpt-5.5")
    }

    expect(config.agent["j.spec"].model).toBe("github-copilot/gpt-5.5")
    expect(config.agent["j.spec-writer"].model).toBe("github-copilot/gpt-5.5")
    expect(config.agent["j.plan"].model).toBe("github-copilot/gpt-5.5")
    expect(config.agent["j.planner"].model).toBe("github-copilot/gpt-5.5")
    expect(config.agent["j.plan-reviewer"].model).toBe("github-copilot/gpt-5.5")
  })
})
