import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { CONTEXT_SPECIAL_DIRS, contextAssetsDir } from "../../../lib/j.workspace-paths"
import { opencodeRoot, repoRoot } from "../../lib/test-utils"

// Context layer: {workspace}/<context>/agent-context/{skill-map.json,skills/}.
// These are the skills that shape the code the agent writes in the target
// repos, so they get the same mechanical contract as the workspace skills.
// Discovery mirrors findContextRoot/contextAssetsDir (the runtime rule) instead
// of hardcoding a context name, so a second context is covered on arrival.
function contextAssetRoots(): string[] {
  return readdirSync(repoRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !CONTEXT_SPECIAL_DIRS.has(entry.name))
    .map((entry) => contextAssetsDir(path.join(repoRoot(), entry.name)))
    .filter((assetsRoot): assetsRoot is string => assetsRoot !== null)
}

function contextSkillFiles(assetsRoot: string): string[] {
  const skillsDir = path.join(assetsRoot, "skills")
  if (!existsSync(skillsDir)) return []
  return Array.from(new Bun.Glob("*/SKILL.md").scanSync({ cwd: skillsDir }))
}

// Body of a `## <heading>` section: everything up to the next h2.
function sectionBody(content: string, heading: RegExp): string | null {
  const lines = content.split("\n")
  const start = lines.findIndex((line) => heading.test(line))
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith("## "))
  return (end === -1 ? rest : rest.slice(0, end)).join("\n")
}

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
      expect(existsSync(path.join(root, relativePath)), `missing: ${relativePath}`).toBe(true)
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
      expect(
        existsSync(path.join(root, ".opencode", "skills", entry.skill, "SKILL.md")),
        `skill-map entry "${entry.skill}" has no SKILL.md`
      ).toBe(true)
    }
  })

  test("context skill map entries point to existing skill folders", () => {
    const root = repoRoot()
    const failures: string[] = []

    for (const assetsRoot of contextAssetRoots()) {
      const mapPath = path.join(assetsRoot, "skill-map.json")
      if (!existsSync(mapPath)) continue

      const label = path.relative(root, mapPath)
      const map = JSON.parse(readFileSync(mapPath, "utf-8")) as Array<{ pattern: string; skill: string }>
      expect(map.length).toBeGreaterThan(0)

      for (const entry of map) {
        expect(entry.pattern.length).toBeGreaterThan(0)
        // compileEntries drops an uncompilable pattern silently, so a typo here
        // would disable the skill at runtime with no error anywhere.
        expect(() => new RegExp(entry.pattern)).not.toThrow()

        // resolveSkillPath tries the context first and falls back to the
        // workspace, so either location is a legitimate target.
        const contextSkill = path.join(assetsRoot, "skills", entry.skill, "SKILL.md")
        const workspaceSkill = path.join(root, ".opencode", "skills", entry.skill, "SKILL.md")
        if (!existsSync(contextSkill) && !existsSync(workspaceSkill)) {
          failures.push(`${label}: "${entry.skill}" has no SKILL.md in the context or the workspace — the pattern never injects`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  test("principles manifest declares no dead entries", () => {
    const root = repoRoot()
    const failures: string[] = []

    // Same bases carl-inject reads a manifest from: the workspace itself and
    // the assets dir of every context. Target repos own their own manifests.
    const bases = [root, ...contextAssetRoots()]

    for (const base of bases) {
      const manifestPath = path.join(base, "docs", "principles", "manifest")
      if (!existsSync(manifestPath)) continue

      const label = path.relative(root, manifestPath) || manifestPath
      // parsePrinciplesManifest drops comment lines before it reads fields, so
      // a commented-out example entry is not a declaration.
      const lines = readFileSync(manifestPath, "utf-8")
        .split("\n")
        .filter((line) => !line.startsWith("#") && line.trim())

      for (const line of lines) {
        const match = /^([A-Z_]+)_FILE=(.*)$/.exec(line)
        if (!match) continue

        const [, key, rawValue] = match
        const value = rawValue.trim()
        if (!value) {
          failures.push(`${label}: ${key}_FILE is empty`)
          continue
        }

        // addPrinciples resolves a relative _FILE against the docs base, and
        // silently skips the entry when the target is missing — a dead entry
        // is a principle that never injects, with no error anywhere.
        const candidates = path.isAbsolute(value)
          ? [value]
          : [path.join(base, value), path.join(path.dirname(manifestPath), value)]

        if (!candidates.some((candidate) => existsSync(candidate))) {
          failures.push(`${label}: ${key}_FILE="${value}" points at no existing file — the principle never injects`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  test("context writing skills carry measured-evidence sections", () => {
    const root = repoRoot()
    const failures: string[] = []

    for (const assetsRoot of contextAssetRoots()) {
      for (const relativePath of contextSkillFiles(assetsRoot)) {
        const skillFile = path.join(assetsRoot, "skills", relativePath)
        const label = path.relative(root, skillFile)
        const content = readFileSync(skillFile, "utf-8")

        if (!content.startsWith("---\nname:")) failures.push(`${label}: frontmatter must open with '---' then 'name:'`)
        if (!content.includes("description:")) failures.push(`${label}: frontmatter has no 'description:'`)
        if (!content.includes("## When this skill activates")) failures.push(`${label}: no '## When this skill activates'`)
        if (
          !content.includes("## Required Steps") &&
          !content.includes("## Required Sections") &&
          !content.includes("## Required Structure") &&
          !content.includes("## Rules")
        ) {
          failures.push(`${label}: no '## Required Steps' (or Rules/Required Sections/Required Structure)`)
        }
        if (!content.includes("## Anti-patterns")) failures.push(`${label}: no '## Anti-patterns'`)

        // A writing skill has to be reproducible from the canon, not from
        // memory: the red lines say what must never ship, and the mimicry test
        // is the pass/fail the author measured the skill against.
        if (/-writing$/.test(path.dirname(relativePath))) {
          if (!content.includes("## RED_LINES")) failures.push(`${label}: writing skill without '## RED_LINES'`)
          if (!content.includes("## Mimicry Test")) failures.push(`${label}: writing skill without '## Mimicry Test'`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  test("context skills stay free of eval and template leakage", () => {
    const root = repoRoot()
    // 'skill-marker:' is an eval fixture tell; the vitest/jest/.test.ts trio is
    // the TypeScript skill template these skills were rewritten from. Either one
    // in a shipped context skill means the file is describing the harness's own
    // fixtures instead of the target repos.
    const leaks: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /skill-marker:/, label: "eval fixture marker 'skill-marker:'" },
      { pattern: /\bvitest\b/i, label: "template leakage 'vitest'" },
      { pattern: /\bjest\b/i, label: "template leakage 'jest'" },
      { pattern: /\.test\.ts\b/, label: "template leakage '.test.ts'" },
    ]
    const failures: string[] = []

    for (const assetsRoot of contextAssetRoots()) {
      for (const relativePath of contextSkillFiles(assetsRoot)) {
        const skillFile = path.join(assetsRoot, "skills", relativePath)
        const content = readFileSync(skillFile, "utf-8")
        for (const leak of leaks) {
          if (leak.pattern.test(content)) failures.push(`${path.relative(root, skillFile)}: ${leak.label}`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  test("context skills expose canonical evidence", () => {
    const root = repoRoot()
    const failures: string[] = []

    for (const assetsRoot of contextAssetRoots()) {
      for (const relativePath of contextSkillFiles(assetsRoot)) {
        if (!/-writing$/.test(path.dirname(relativePath))) continue

        const skillFile = path.join(assetsRoot, "skills", relativePath)
        const label = path.relative(root, skillFile)
        const content = readFileSync(skillFile, "utf-8")
        const canonical = sectionBody(content, /^## Canonical Example/)

        if (canonical === null) {
          failures.push(`${label}: no '## Canonical Example' — the skill cites no measured code from the canon`)
          continue
        }
        // Prose alone is not evidence: the section has to carry the code the
        // rules were read off of.
        if ((canonical.match(/^```/gm) ?? []).length < 2) {
          failures.push(`${label}: '## Canonical Example' has no fenced code block`)
        }
      }
    }

    expect(failures).toEqual([])
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
    expect(reviewer).toContain("Integration validation reuses scripts deliberately")
  })

  test("idle notifications support foreground suppression", () => {
    const root = repoRoot()
    const notifyPlugin = readFileSync(path.join(root, ".opencode/plugins/j.notify.ts"), "utf-8")
    const config = readFileSync(path.join(root, ".opencode/lib/j.juninho-config.ts"), "utf-8")
    const validator = readFileSync(path.join(root, ".opencode/cli/config-validate.ts"), "utf-8")

    expect(notifyPlugin).toContain("hostTerminalIsFrontmost")
    expect(notifyPlugin).toContain("idleNotificationsOnlyWhenBackground")
    expect(notifyPlugin).toContain("idleNotificationsSilent")
    expect(notifyPlugin).toContain("idleNotificationSound")
    expect(config).toContain("idleNotificationsOnlyWhenBackground: true")
    expect(config).toContain('idleNotificationSound: "Glass"')
    expect(validator).toContain('"idleNotificationsOnlyWhenBackground"')
    expect(validator).toContain('"idleNotificationsSilent"')
    expect(validator).toContain('"idleNotificationSound"')
  })

  test("runtime validation scripts require discovery and developer choice", () => {
    const root = repoRoot()
    const planner = readFileSync(path.join(root, ".opencode/agents/j.planner.md"), "utf-8")
    const reviewer = readFileSync(path.join(root, ".opencode/agents/j.plan-reviewer.md"), "utf-8")
    const planningSkill = readFileSync(
      path.join(root, ".opencode/skills/j.planning-artifact-writing/SKILL.md"),
      "utf-8"
    )

    for (const content of [planner, reviewer, planningSkill]) {
      expect(content).toContain("same endpoint, workflow, or runtime fixture")
      expect(content).toContain("create a separate")
    }

    expect(planner).toContain("ask the developer whether to update that script")
    expect(planningSkill).toContain("ask the developer whether to update it")
    expect(reviewer).toContain("the planner asks the developer whether to update it")
    expect(planner).toContain("Record the candidates and coverage gaps in `CONTEXT.md`")
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

  test("agent models in opencode.json match juninho-config.json tiers via template", () => {
    const root = repoRoot()
    const juninhoConfig = JSON.parse(
      readFileSync(path.join(root, "juninho-config.json"), "utf-8"),
    ) as { models: { strong: string; medium: string; weak: string } }
    const opencodeConfig = JSON.parse(
      readFileSync(path.join(root, "opencode.json"), "utf-8"),
    ) as { agent: Record<string, { model: string }> }
    const templateContent = readFileSync(path.join(root, "opencode.template.json"), "utf-8")

    expect(juninhoConfig.models.strong).toBeTruthy()
    expect(juninhoConfig.models.medium).toBeTruthy()
    expect(juninhoConfig.models.weak).toBeTruthy()

    // Template must use placeholders
    expect(templateContent).toContain("__STRONG_MODEL__")
    expect(templateContent).toContain("__MEDIUM_MODEL__")
    expect(templateContent).toContain("__WEAK_MODEL__")

    // Generated opencode.json must NOT contain placeholders
    const generatedContent = readFileSync(path.join(root, "opencode.json"), "utf-8")
    expect(generatedContent).not.toContain("__STRONG_MODEL__")
    expect(generatedContent).not.toContain("__MEDIUM_MODEL__")
    expect(generatedContent).not.toContain("__WEAK_MODEL__")

    // Strong-tier agents
    const strongAgents = ["j.planner", "j.plan-reviewer", "j.spec-writer", "j.validator", "j.reviewer", "j.checker", "j.unify", "j.plan", "j.spec"]
    for (const agent of strongAgents) {
      expect(opencodeConfig.agent[agent]?.model).toBe(juninhoConfig.models.strong)
    }

    // Medium-tier agents
    expect(opencodeConfig.agent["j.implementer"]?.model).toBe(juninhoConfig.models.medium)

    // Weak-tier agents
    for (const agent of ["j.explore", "j.librarian"]) {
      expect(opencodeConfig.agent[agent]?.model).toBe(juninhoConfig.models.weak)
    }
  })
})
