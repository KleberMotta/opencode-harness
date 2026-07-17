import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { contextAssetsDir, findContainingProjectRoot, findContextRoot } from "../lib/j.workspace-paths"
import { argFilePath, toolIs } from "../lib/j.tool-compat"

// Injects skill instructions via tool.execute.after on Read + Write.
// SKILL_MAP is loaded from .opencode/skill-map.json for dynamic
// extension by /j.finish-setup.
//
// Multi-project: merges the workspace skill-map with the containing context's
// map ({context}/agent-context/skill-map.json) and the containing project's
// map (project > context > workspace). Symmetric with resolveSkillPath which
// searches project > context > workspace for SKILL.md.

interface SkillMapEntry { pattern: string; skill: string }
type CompiledEntry = { pattern: RegExp; skill: string; source: "project" | "context" | "workspace" | "default" }

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

function mapFileMtime(mapPath: string): number {
  try {
    return statSync(mapPath).mtimeMs
  } catch {
    return 0
  }
}

function readMapFile(mapPath: string): SkillMapEntry[] {
  if (!existsSync(mapPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(mapPath, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function compileEntries(entries: SkillMapEntry[], source: CompiledEntry["source"]): CompiledEntry[] {
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
  let contextMap: SkillMapEntry[] = []
  if (filePath) {
    const projectRoot = findContainingProjectRoot(workspaceRoot, filePath)
    if (projectRoot && projectRoot !== workspaceRoot) {
      projectMap = readMapFile(path.join(projectRoot, ".opencode", "skill-map.json"))
    }
    const contextAssets = contextAssetsDir(findContextRoot(workspaceRoot, filePath))
    if (contextAssets) {
      contextMap = readMapFile(path.join(contextAssets, "skill-map.json"))
    }
  }

  // Merge: project entries first (precedence), then context, then workspace,
  // then defaults if all empty.
  const projectCompiled = compileEntries(projectMap, "project")
  const contextCompiled = compileEntries(contextMap, "context")
  const workspaceCompiled = compileEntries(workspaceMap, "workspace")

  if (projectCompiled.length === 0 && contextCompiled.length === 0 && workspaceCompiled.length === 0) {
    return compileEntries(DEFAULT_ENTRIES, "default")
  }

  // Deduplicate by skill name preferring the most specific source: a project
  // pattern for skill X overrides a context pattern for skill X, which
  // overrides a workspace pattern for skill X.
  const projectSkills = new Set(projectCompiled.map((e) => e.skill))
  const filteredContext = contextCompiled.filter((e) => !projectSkills.has(e.skill))
  const contextSkills = new Set(filteredContext.map((e) => e.skill))
  const filteredWorkspace = workspaceCompiled.filter((e) => !projectSkills.has(e.skill) && !contextSkills.has(e.skill))
  return [...projectCompiled, ...filteredContext, ...filteredWorkspace]
}

function resolveSkillPath(directory: string, skillName: string, filePath?: string): string | null {
  // Check target project root skills first when a file path is available
  if (filePath) {
    const projectRoot = findContainingProjectRoot(directory, filePath)
    if (projectRoot && projectRoot !== directory) {
      const projectPath = path.join(projectRoot, ".opencode", "skills", skillName, "SKILL.md")
      if (existsSync(projectPath)) return projectPath
    }

    // Context assets next: {context}/agent-context/skills/{name}/SKILL.md
    const contextAssets = contextAssetsDir(findContextRoot(directory, filePath))
    if (contextAssets) {
      const contextPath = path.join(contextAssets, "skills", skillName, "SKILL.md")
      if (existsSync(contextPath)) return contextPath
    }
  }

  // Workspace skills as fallback
  const workspacePath = path.join(directory, ".opencode", "skills", skillName, "SKILL.md")
  if (existsSync(workspacePath)) return workspacePath

  return null
}

export default (async ({ directory }: { directory: string }) => {
  const injectedSkills = new Set<string>()
  // Cache merged maps per project + context root to avoid re-parsing on every
  // tool call. The key includes the mtimes of the candidate skill-map.json
  // files so edits at runtime (e.g. /j.finish-setup writing a context map)
  // invalidate the cached merge; a missing file contributes mtime 0.
  const MAP_CACHE_LIMIT = 256
  const mapCache = new Map<string, CompiledEntry[]>()

  function getSkillMap(filePath: string): CompiledEntry[] {
    const projectRoot = filePath ? findContainingProjectRoot(directory, filePath) ?? directory : directory
    const contextRoot = filePath ? findContextRoot(directory, filePath) : null
    const contextAssets = contextAssetsDir(contextRoot)
    const mtimes = [
      mapFileMtime(path.join(directory, ".opencode", "skill-map.json")),
      contextAssets ? mapFileMtime(path.join(contextAssets, "skill-map.json")) : 0,
      projectRoot !== directory ? mapFileMtime(path.join(projectRoot, ".opencode", "skill-map.json")) : 0,
    ]
    const key = `${projectRoot}::${contextRoot ?? ""}::${mtimes.join(":")}`
    const cached = mapCache.get(key)
    if (cached) return cached
    if (mapCache.size >= MAP_CACHE_LIMIT) mapCache.clear()
    const fresh = loadMergedSkillMap(directory, filePath)
    mapCache.set(key, fresh)
    return fresh
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const filePath = argFilePath(input.args)
      if (!filePath) return

      const skillMap = getSkillMap(filePath)
      const matches = skillMap.filter(({ pattern }) => pattern.test(filePath))
      if (matches.length === 0) return

      if (toolIs(input.tool, "read")) {
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
      } else if (toolIs(input.tool, "write", "edit")) {
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
