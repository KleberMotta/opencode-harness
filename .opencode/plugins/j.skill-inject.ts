import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { findContainingProjectRoot } from "../lib/j.workspace-paths"

// Injects skill instructions via tool.execute.after on Read + Write.
// SKILL_MAP is loaded from .opencode/skill-map.json for dynamic
// extension by /j.finish-setup.
//
// Multi-project: merges workspace skill-map with the containing project's
// skill-map (project entries take precedence). Symmetric with resolveSkillPath
// which already searches project roots as fallback.

interface SkillMapEntry { pattern: string; skill: string }
type CompiledEntry = { pattern: RegExp; skill: string; source: "project" | "workspace" | "default" }

const DEFAULT_ENTRIES: SkillMapEntry[] = [
  { pattern: "\\.test\\.(ts|tsx|js|jsx)$", skill: "j.test-writing" },
  { pattern: "\\.spec\\.(ts|tsx|js|jsx)$", skill: "j.test-writing" },
  { pattern: "(^|\\/)AGENTS\\.md$", skill: "j.agents-md-writing" },
  { pattern: "(^|\\/)\\.opencode\\/skills\\/[^/]+\\/SKILL\\.md$|(^|\\/)\\.opencode\\/skill-map\\.json$|(^|\\/)\\.opencode\\/evals\\/.*(skill|behavioral).*(\\.xml|\\.json|\\.md|\\.ts)$", skill: "skill-creator" },
  { pattern: "docs\\/domain\\/.*\\.md$", skill: "j.domain-doc-writing" },
  { pattern: "docs\\/principles\\/.*(?:\\.md|manifest)$", skill: "j.principle-doc-writing" },
  { pattern: "(^|\\/)(\\.opencode\\/scripts|scripts)\\/.*\\.sh$", skill: "j.shell-script-writing" },
  { pattern: "(^|\\/)pre-commit$", skill: "j.shell-script-writing" },
]

function readMapFile(mapPath: string): SkillMapEntry[] {
  if (!existsSync(mapPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(mapPath, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function compileEntries(entries: SkillMapEntry[], source: "project" | "workspace" | "default"): CompiledEntry[] {
  return entries
    .filter((e) => e?.pattern && e?.skill)
    .map((e) => {
      try {
        return { pattern: new RegExp(e.pattern), skill: e.skill, source }
      } catch {
        return null
      }
    })
    .filter((e): e is CompiledEntry => e !== null)
}

function loadMergedSkillMap(workspaceRoot: string, filePath: string): CompiledEntry[] {
  const workspaceMap = readMapFile(path.join(workspaceRoot, ".opencode", "skill-map.json"))

  let projectMap: SkillMapEntry[] = []
  if (filePath) {
    const projectRoot = findContainingProjectRoot(workspaceRoot, filePath)
    if (projectRoot && projectRoot !== workspaceRoot) {
      projectMap = readMapFile(path.join(projectRoot, ".opencode", "skill-map.json"))
    }
  }

  // Merge: project entries first (precedence), then workspace, then defaults if both empty.
  const projectCompiled = compileEntries(projectMap, "project")
  const workspaceCompiled = compileEntries(workspaceMap, "workspace")

  if (projectCompiled.length === 0 && workspaceCompiled.length === 0) {
    return compileEntries(DEFAULT_ENTRIES, "default")
  }

  // Deduplicate by skill name preferring project entries: a project pattern for
  // skill X overrides a workspace pattern for skill X.
  const projectSkills = new Set(projectCompiled.map((e) => e.skill))
  const filteredWorkspace = workspaceCompiled.filter((e) => !projectSkills.has(e.skill))
  return [...projectCompiled, ...filteredWorkspace]
}

function resolveSkillPath(directory: string, skillName: string, filePath?: string): string | null {
  // Check target project root skills first when a file path is available
  if (filePath) {
    const projectRoot = findContainingProjectRoot(directory, filePath)
    if (projectRoot && projectRoot !== directory) {
      const projectPath = path.join(projectRoot, ".opencode", "skills", skillName, "SKILL.md")
      if (existsSync(projectPath)) return projectPath
    }
  }

  // Workspace skills as fallback
  const workspacePath = path.join(directory, ".opencode", "skills", skillName, "SKILL.md")
  if (existsSync(workspacePath)) return workspacePath

  return null
}

export default (async ({ directory }: { directory: string }) => {
  const injectedSkills = new Set<string>()
  // Cache merged maps per project root to avoid re-parsing on every tool call.
  const mapCache = new Map<string, CompiledEntry[]>()

  function getSkillMap(filePath: string): CompiledEntry[] {
    const projectRoot = filePath ? findContainingProjectRoot(directory, filePath) ?? directory : directory
    const key = projectRoot
    const cached = mapCache.get(key)
    if (cached) return cached
    const fresh = loadMergedSkillMap(directory, filePath)
    mapCache.set(key, fresh)
    return fresh
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const filePath: string = input.args?.path ?? input.args?.file_path ?? ""
      if (!filePath) return

      const skillMap = getSkillMap(filePath)
      const matches = skillMap.filter(({ pattern }) => pattern.test(filePath))
      if (matches.length === 0) return

      if (input.tool === "Read") {
        const injectedBlocks: string[] = []
        for (const match of matches) {
          const key = `${input.sessionID}:${match.skill}`
          if (injectedSkills.has(key)) continue

          const skillPath = resolveSkillPath(directory, match.skill, filePath)
          if (!skillPath) continue

          injectedSkills.add(key)
          const skillContent = readFileSync(skillPath, "utf-8")
          injectedBlocks.push(`\n\n[skill-inject] Skill activated for ${match.skill} (${match.source}):\n\n${skillContent}`)
        }
        if (injectedBlocks.length > 0) output.output += injectedBlocks.join("")
      } else if (["Write", "Edit", "MultiEdit"].includes(input.tool)) {
        const reminders: string[] = []
        for (const match of matches) {
          const key = `${input.sessionID}:${match.skill}`
          if (injectedSkills.has(key)) continue

          const skillPath = resolveSkillPath(directory, match.skill, filePath)
          if (!skillPath) continue

          injectedSkills.add(key)
          reminders.push(`[skill-inject] IMPORTANT: Skill "${match.skill}" (${match.source}) exists for this file type. Read the matching file first to receive full skill instructions.`)
        }
        if (reminders.length > 0) output.output += `\n\n${reminders.join("\n")}`
      }
    },
  }
}) satisfies Plugin
