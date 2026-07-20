import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import {
  contextRootsForFile,
  findContainingProjectRoot,
} from "./j.workspace-paths"

// Shared skill-map resolution: merging, regex compilation and SKILL.md lookup.
// Single source of truth for j.skill-inject.ts (runtime injection) and
// .opencode/cli/skills-coverage.ts (static audit) — both must answer
// "which skills fire for this file?" identically, otherwise the audit lies.
//
// Precedence across the harness: project > nearest context > ancestor contexts > workspace.

export type SkillSource = "project" | "context" | "workspace" | "default"

export interface SkillMapEntry {
  pattern: string
  skill: string
}

// Plans are durable artifacts. Keep old skill IDs resolvable while their
// context maps and future plans use the stack-specific names.
export const LEGACY_SKILL_ALIASES: Record<string, string> = {
  "j.api-client-writing": "j.spring-feign-client-writing",
  "j.client-writing": "j.spring-client-boundary-writing",
  "j.configuration-writing": "j.spring-configuration-writing",
  "j.controller-writing": "j.spring-mvc-controller-writing",
  "j.dto-writing": "j.spring-web-dto-writing",
  "j.entity-writing": "j.spring-jpa-entity-writing",
  "j.exception-writing": "j.spring-domain-exception-writing",
  "j.listener-writing": "j.spring-sqs-listener-writing",
  "j.mapper-writing": "j.kotlin-mapper-writing",
  "j.migration-writing": "j.flyway-migration-writing",
  "j.model-writing": "j.kotlin-domain-model-writing",
  "j.python-script-writing": "j.python-runtime-validation-writing",
  "j.repository-writing": "j.spring-data-jpa-repository-writing",
  "j.seller-domain-model-writing": "j.spring-seller-domain-model-writing",
  "j.service-writing": "j.spring-domain-service-writing",
  "j.test-writing": "j.spring-test-writing",
  "j.utility-writing": "j.kotlin-utility-writing",
}

export function canonicalSkillName(skillName: string): string {
  return LEGACY_SKILL_ALIASES[skillName] ?? skillName
}

export type CompiledEntry = {
  pattern: RegExp
  skill: string
  source: SkillSource
}

export const DEFAULT_ENTRIES: SkillMapEntry[] = [
  { pattern: "\\.test\\.(ts|tsx|js|jsx)$", skill: "j.frontend-test-writing" },
  { pattern: "\\.spec\\.(ts|tsx|js|jsx)$", skill: "j.frontend-test-writing" },
  { pattern: "(^|/)test_[^/]+\\.py$|(^|/)[^/]+_test\\.py$", skill: "j.python-test-writing" },
  { pattern: "(^|\\/)AGENTS\\.md$", skill: "j.agents-md-writing" },
  { pattern: "(^|\\/)\\.opencode\\/skills\\/[^/]+\\/SKILL\\.md$|(^|\\/)\\.opencode\\/skill-map\\.json$|(^|\\/)\\.opencode\\/evals\\/.*(skill|behavioral).*(\\.xml|\\.json|\\.md|\\.ts)$", skill: "skill-creator" },
  { pattern: "docs\\/domain\\/.*\\.md$", skill: "j.domain-doc-writing" },
  { pattern: "docs\\/principles\\/.*(?:\\.md|manifest)$", skill: "j.principle-doc-writing" },
  { pattern: "(^|\\/)(\\.opencode\\/scripts|scripts)\\/.*\\.sh$", skill: "j.shell-script-writing" },
  { pattern: "(^|\\/)pre-commit$", skill: "j.shell-script-writing" },
]

export function mapFileMtime(mapPath: string): number {
  try {
    return statSync(mapPath).mtimeMs
  } catch {
    return 0
  }
}

export function readMapFile(mapPath: string): SkillMapEntry[] {
  if (!existsSync(mapPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(mapPath, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function compileEntries(entries: SkillMapEntry[], source: SkillSource): CompiledEntry[] {
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

export function loadMergedSkillMap(workspaceRoot: string, filePath: string): CompiledEntry[] {
  const workspaceMap = readMapFile(path.join(workspaceRoot, ".opencode", "skill-map.json"))

  let projectMap: SkillMapEntry[] = []
  let contextMaps: SkillMapEntry[][] = []
  if (filePath) {
    const projectRoot = findContainingProjectRoot(workspaceRoot, filePath)
    if (projectRoot && projectRoot !== workspaceRoot) {
      projectMap = readMapFile(path.join(projectRoot, ".opencode", "skill-map.json"))
    }
    contextMaps = contextRootsForFile(workspaceRoot, filePath).map((root) =>
      readMapFile(path.join(root, "skill-map.json"))
    )
  }

  // Merge: project entries first, then nearest/ancestor contexts, then workspace,
  // then defaults if all empty.
  const projectCompiled = compileEntries(projectMap, "project")
  const contextCompiledByRoot = contextMaps.map((entries) => compileEntries(entries, "context"))
  const workspaceCompiled = compileEntries(workspaceMap, "workspace")

  if (
    projectCompiled.length === 0 &&
    contextCompiledByRoot.every((entries) => entries.length === 0) &&
    workspaceCompiled.length === 0
  ) {
    return compileEntries(DEFAULT_ENTRIES, "default")
  }

  // Deduplicate by skill name preferring the most specific source.
  const projectSkills = new Set(projectCompiled.map((e) => e.skill))
  const contextSkills = new Set<string>()
  const filteredContext: CompiledEntry[] = []
  for (const contextEntries of contextCompiledByRoot) {
    for (const entry of contextEntries) {
      if (projectSkills.has(entry.skill) || contextSkills.has(entry.skill)) continue
      contextSkills.add(entry.skill)
      filteredContext.push(entry)
    }
  }
  const filteredWorkspace = workspaceCompiled.filter(
    (e) =>
      !projectSkills.has(e.skill) &&
      !contextSkills.has(e.skill)
  )
  return [...projectCompiled, ...filteredContext, ...filteredWorkspace]
}

export function resolveSkillPath(directory: string, skillName: string, filePath?: string): string | null {
  const canonicalName = canonicalSkillName(skillName)
  // Prefer the exact identifier when it exists. This preserves workspace and
  // sandbox skills that intentionally retain a legacy ID, while old persisted
  // plans still resolve to the renamed context skill as a fallback.
  const candidateNames = canonicalName === skillName ? [skillName] : [skillName, canonicalName]

  function firstSkillPath(baseDir: string): string | null {
    for (const candidateName of candidateNames) {
      const candidate = path.join(baseDir, "skills", candidateName, "SKILL.md")
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  // Check target project root skills first when a file path is available
  if (filePath) {
    const projectRoot = findContainingProjectRoot(directory, filePath)
    if (projectRoot && projectRoot !== directory) {
      const projectPath = firstSkillPath(path.join(projectRoot, ".opencode"))
      if (projectPath) return projectPath
    }

    for (const contextRoot of contextRootsForFile(directory, filePath)) {
      const contextPath = firstSkillPath(contextRoot)
      if (contextPath) return contextPath
    }
  }

  // Workspace skills as fallback
  const workspacePath = firstSkillPath(path.join(directory, ".opencode"))
  if (workspacePath) return workspacePath

  return null
}

// Caches merged maps per project + context root to avoid re-parsing on every
// lookup. The key includes the mtimes of the candidate skill-map.json files so
// edits at runtime (e.g. /j.finish-setup writing a context map) invalidate the
// cached merge; a missing file contributes mtime 0.
export function createSkillMapResolver(directory: string, cacheLimit = 256): (filePath: string) => CompiledEntry[] {
  const mapCache = new Map<string, CompiledEntry[]>()

  return function getSkillMap(filePath: string): CompiledEntry[] {
    const projectRoot = filePath ? findContainingProjectRoot(directory, filePath) ?? directory : directory
    const contextRoots = filePath ? contextRootsForFile(directory, filePath) : []
    const mtimes = [
      mapFileMtime(path.join(directory, ".opencode", "skill-map.json")),
      ...contextRoots.map((root) => mapFileMtime(path.join(root, "skill-map.json"))),
      projectRoot !== directory ? mapFileMtime(path.join(projectRoot, ".opencode", "skill-map.json")) : 0,
    ]
    const key = `${projectRoot}::${contextRoots.join("|")}::${mtimes.join(":")}`
    const cached = mapCache.get(key)
    if (cached) return cached
    if (mapCache.size >= cacheLimit) mapCache.clear()
    const fresh = loadMergedSkillMap(directory, filePath)
    mapCache.set(key, fresh)
    return fresh
  }
}
