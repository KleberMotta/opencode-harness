import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { findContainingProjectRoot } from "../lib/j.workspace-paths"

// Injects skill instructions via tool.execute.after on Read + Write.
// SKILL_MAP is loaded from .opencode/skill-map.json for dynamic
// extension by /j.finish-setup. Falls back to hardcoded base patterns.

interface SkillMapEntry { pattern: string; skill: string }

function loadSkillMap(directory: string): Array<{ pattern: RegExp; skill: string }> {
  const mapPath = path.join(directory, ".opencode", "skill-map.json")
  let entries: SkillMapEntry[] = []

  if (existsSync(mapPath)) {
    try { entries = JSON.parse(readFileSync(mapPath, "utf-8")) } catch { entries = [] }
  }

  if (entries.length === 0) { entries = [{"pattern":"\\.test\\.(ts|tsx|js|jsx)$","skill":"j.test-writing"},{"pattern":"\\.spec\\.(ts|tsx|js|jsx)$","skill":"j.test-writing"},{"pattern":"(^|\\/)AGENTS\\.md$","skill":"j.agents-md-writing"},{"pattern":"(^|\\/)\\.opencode\\/skills\\/[^/]+\\/SKILL\\.md$|(^|\\/)\\.opencode\\/skill-map\\.json$|(^|\\/)\\.opencode\\/evals\\/.*(skill|behavioral).*(\\.xml|\\.json|\\.md|\\.ts)$","skill":"skill-creator"},{"pattern":"docs\\/domain\\/.*\\.md$","skill":"j.domain-doc-writing"},{"pattern":"docs\\/principles\\/.*(?:\\.md|manifest)$","skill":"j.principle-doc-writing"},{"pattern":"(^|\\/)(\\.opencode\\/scripts|scripts)\\/.*\\.sh$","skill":"j.shell-script-writing"},{"pattern":"(^|\\/)pre-commit$","skill":"j.shell-script-writing"}] }

  return entries.map((e) => ({ pattern: new RegExp(e.pattern), skill: e.skill }))
}

function resolveSkillPath(directory: string, skillName: string, filePath?: string): string | null {
  // Check workspace-root skills first
  const workspacePath = path.join(directory, ".opencode", "skills", skillName, "SKILL.md")
  if (existsSync(workspacePath)) return workspacePath

  // Check target project root skills as fallback
  if (filePath) {
    const projectRoot = findContainingProjectRoot(directory, filePath)
    if (projectRoot && projectRoot !== directory) {
      const projectPath = path.join(projectRoot, ".opencode", "skills", skillName, "SKILL.md")
      if (existsSync(projectPath)) return projectPath
    }
  }

  return null
}

export default (async ({ directory }: { directory: string }) => {
  const injectedSkills = new Set<string>()
  const skillMap = loadSkillMap(directory)

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const filePath: string = input.args?.path ?? input.args?.file_path ?? ""
      if (!filePath) return

      const match = skillMap.find(({ pattern }) => pattern.test(filePath))
      if (!match) return

      const key = `${input.sessionID}:${match.skill}`

      if (input.tool === "Read") {
        if (injectedSkills.has(key)) return
        injectedSkills.add(key)

        const skillPath = resolveSkillPath(directory, match.skill, filePath)
        if (!skillPath) return

        const skillContent = readFileSync(skillPath, "utf-8")
        output.output +=
          `\n\n[skill-inject] Skill activated for ${match.skill}:\n\n${skillContent}`
      } else if (["Write", "Edit", "MultiEdit"].includes(input.tool)) {
        if (injectedSkills.has(key)) return

        const skillPath = resolveSkillPath(directory, match.skill, filePath)
        if (!skillPath) return

        injectedSkills.add(key)
        output.output +=
          `\n\n[skill-inject] IMPORTANT: Skill "${match.skill}" exists for this file type. ` +
          `Read the matching file first to receive full skill instructions.`
      }
    },
  }
}) satisfies Plugin
