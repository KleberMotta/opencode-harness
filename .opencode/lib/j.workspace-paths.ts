import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import path from "path"

type ProjectHints = {
  prompt?: string
  planPath?: string
  specPath?: string
  contextPath?: string
  taskContractPath?: string
  targetRepoRoot?: string
}

type ActivePlanTarget = {
  project?: string
  slug?: string
  planPath?: string
  specPath?: string
  contextPath?: string
  targetRepoRoot?: string
}

type ActivePlanReferenceProject = {
  project?: string
  targetRepoRoot?: string
  reason?: string
}

type ActivePlanState = {
  slug?: string
  writeTargets?: ActivePlanTarget[]
  targets?: ActivePlanTarget[]
  referenceProjects?: ActivePlanReferenceProject[]
}

type ActivePlanLoadHints = ProjectHints & {
  preferProjectState?: boolean
}

type ProjectPaths = {
  workspaceRoot: string
  harnessRoot: string
  projectRoot: string
  stateRoot: string
  docsRoot: string
  specsRoot: string
  principlesRoot: string
  domainRoot: string
  projectLabel: string
}

const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".opencode",
  "build",
  "dist",
  "node_modules",
  "target",
  "tmp",
])

const discoveryCache = new Map<string, string[]>()

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

function looksLikeProjectRoot(directory: string): boolean {
  if (!existsSync(directory)) return false
  return existsSync(path.join(directory, ".git")) || (existsSync(path.join(directory, "opencode.json")) && existsSync(path.join(directory, "docs")))
}

function walkProjects(current: string, depth: number, found: Set<string>): void {
  if (depth < 0 || !existsSync(current)) return
  if (looksLikeProjectRoot(current)) {
    found.add(current)
    return
  }

  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(current, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (IGNORED_DIRS.has(entry.name)) continue
    walkProjects(path.join(current, entry.name), depth - 1, found)
  }
}

function uniqueSorted(paths: Iterable<string>): string[] {
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right))
}

function looksLikeDirectDocsPath(value: string): boolean {
  return /^docs\//.test(normalizePath(value))
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function discoverWorkspaceProjects(workspaceRoot: string): string[] {
  const cached = discoveryCache.get(workspaceRoot)
  if (cached) return cached

  const found = new Set<string>()
  if (looksLikeProjectRoot(workspaceRoot)) found.add(workspaceRoot)
  walkProjects(workspaceRoot, 4, found)

  const projects = uniqueSorted(found)
  discoveryCache.set(workspaceRoot, projects)
  return projects
}

export function findContainingProjectRoot(workspaceRoot: string, targetPath: string): string | null {
  const absolutePath = path.resolve(targetPath)
  let current = absolutePath
  try {
    if (!statSync(absolutePath).isDirectory()) current = path.dirname(absolutePath)
  } catch {
    current = path.dirname(absolutePath)
  }

  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  while (current.startsWith(normalizedWorkspaceRoot)) {
    if (looksLikeProjectRoot(current)) return current
    if (current === normalizedWorkspaceRoot) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

function scoreProjectMatch(workspaceRoot: string, projectRoot: string, text: string): number {
  const normalizedText = normalizePath(text)
  const relativeRoot = normalizePath(path.relative(workspaceRoot, projectRoot))
  const projectName = path.basename(projectRoot)
  let score = 0

  if (relativeRoot && normalizedText.includes(relativeRoot)) score = Math.max(score, relativeRoot.length + 20)
  if (relativeRoot && normalizedText.includes("@" + relativeRoot + "/")) score = Math.max(score, relativeRoot.length + 30)
  if (relativeRoot && normalizedText.includes(relativeRoot + "/docs/")) score = Math.max(score, relativeRoot.length + 40)

  const projectNamePattern = new RegExp("(^|[^\\w-])" + escapeRegex(projectName) + "([^\\w-]|$)", "i")
  if (projectNamePattern.test(normalizedText)) score = Math.max(score, projectName.length)

  return score
}

export function inferProjectRootFromText(workspaceRoot: string, text: string): string | null {
  const projects = discoverWorkspaceProjects(workspaceRoot)
  if (projects.length === 0) return null
  if (!text.trim()) return projects.length === 1 ? projects[0] : null

  const ranked = projects
    .map((projectRoot) => ({ projectRoot, score: scoreProjectMatch(workspaceRoot, projectRoot, text) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  if (ranked.length > 0) return ranked[0].projectRoot
  return projects.length === 1 ? projects[0] : null
}

function resolveProjectFromPathHint(workspaceRoot: string, value?: string): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (path.isAbsolute(trimmed)) return findContainingProjectRoot(workspaceRoot, trimmed)

  const normalized = normalizePath(trimmed)
  if (looksLikeDirectDocsPath(normalized)) return null

  const candidate = path.resolve(workspaceRoot, trimmed)
  const containing = findContainingProjectRoot(workspaceRoot, candidate)
  if (containing) return containing

  return inferProjectRootFromText(workspaceRoot, normalized)
}

export function resolveTargetProjectRoot(workspaceRoot: string, hints: ProjectHints = {}): string | null {
  const explicitTarget = hints.targetRepoRoot?.trim()
  if (explicitTarget) {
    const resolvedExplicit = path.isAbsolute(explicitTarget) ? explicitTarget : path.resolve(workspaceRoot, explicitTarget)
    if (looksLikeProjectRoot(resolvedExplicit)) return resolvedExplicit
    const containing = findContainingProjectRoot(workspaceRoot, resolvedExplicit)
    if (containing) return containing
  }

  const pathHints = [hints.planPath, hints.specPath, hints.contextPath, hints.taskContractPath]
  for (const hint of pathHints) {
    const projectRoot = resolveProjectFromPathHint(workspaceRoot, hint)
    if (projectRoot) return projectRoot
  }

  if (hints.prompt) {
    const fromPrompt = inferProjectRootFromText(workspaceRoot, hints.prompt)
    if (fromPrompt) return fromPrompt
  }

  const projects = discoverWorkspaceProjects(workspaceRoot)
  if (projects.length === 1) return projects[0]
  if (looksLikeProjectRoot(workspaceRoot)) return workspaceRoot
  return workspaceRoot
}

export function resolvePathFromProjectRoot(projectRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.join(projectRoot, value)
}

export function getGraphifyPath(targetRepoRoot: string, outputDir = "docs/domain/graphify"): string {
  const trimmedOutputDir = outputDir.trim() || "docs/domain/graphify"
  return path.isAbsolute(trimmedOutputDir) ? trimmedOutputDir : path.join(targetRepoRoot, trimmedOutputDir)
}

export function resolveProjectPaths(workspaceRoot: string, hints: ProjectHints = {}): ProjectPaths | null {
  const projectRoot = resolveTargetProjectRoot(workspaceRoot, hints)
  if (!projectRoot) return null

  return {
    workspaceRoot,
    harnessRoot: path.join(workspaceRoot, ".opencode"),
    projectRoot,
    stateRoot: path.join(workspaceRoot, ".opencode", "state"),
    docsRoot: path.join(projectRoot, "docs"),
    specsRoot: path.join(projectRoot, "docs", "specs"),
    principlesRoot: path.join(projectRoot, "docs", "principles"),
    domainRoot: path.join(projectRoot, "docs", "domain"),
    projectLabel: normalizePath(path.relative(workspaceRoot, projectRoot)) || ".",
  }
}

function readActivePlanStateFile(activePlanPath: string): ActivePlanState | null {
  if (!existsSync(activePlanPath)) return null

  try {
    return JSON.parse(readFileSync(activePlanPath, "utf-8")) as ActivePlanState
  } catch {
    return null
  }
}

function projectStateFile(projectRoot: string): string {
  return path.join(projectRoot, ".opencode", "state", "active-plan.json")
}

function workspaceStateFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".opencode", "state", "active-plan.json")
}

function scorePromptProjectMatch(workspaceRoot: string, projectRoot: string, hints: ActivePlanLoadHints = {}): number {
  let score = 0
  if (hints.targetRepoRoot) {
    const resolvedTarget = path.isAbsolute(hints.targetRepoRoot)
      ? hints.targetRepoRoot
      : path.resolve(workspaceRoot, hints.targetRepoRoot)
    if (path.resolve(projectRoot) === path.resolve(resolvedTarget)) score += 1000
  }

  const textHints = [hints.prompt, hints.planPath, hints.specPath, hints.contextPath, hints.taskContractPath]
    .filter((value): value is string => Boolean(value && value.trim()))

  for (const hint of textHints) {
    score = Math.max(score, scoreProjectMatch(workspaceRoot, projectRoot, hint))
  }

  return score
}

function resolveCandidateActivePlanFiles(workspaceRoot: string, hints: ActivePlanLoadHints = {}): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  function pushCandidate(filePath: string | null | undefined): void {
    if (!filePath) return
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) return
    seen.add(resolved)
    candidates.push(resolved)
  }

  const hintedProjectRoot = resolveTargetProjectRoot(workspaceRoot, hints)
  if (hintedProjectRoot) pushCandidate(projectStateFile(hintedProjectRoot))

  if (hints.prompt) {
    const inferredFromPrompt = inferProjectRootFromText(workspaceRoot, hints.prompt)
    if (inferredFromPrompt) pushCandidate(projectStateFile(inferredFromPrompt))
  }

  if (hints.preferProjectState) {
    const scoredProjects = discoverWorkspaceProjects(workspaceRoot)
      .map((projectRoot) => ({ projectRoot, score: scorePromptProjectMatch(workspaceRoot, projectRoot, hints) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)

    for (const entry of scoredProjects) pushCandidate(projectStateFile(entry.projectRoot))
  }

  pushCandidate(workspaceStateFile(workspaceRoot))
  return candidates
}

function loadActivePlanState(workspaceRoot: string, hints: ActivePlanLoadHints = {}): { state: ActivePlanState; sourcePath: string } | null {
  const candidates = resolveCandidateActivePlanFiles(workspaceRoot, hints)
  for (const candidate of candidates) {
    const state = readActivePlanStateFile(candidate)
    if (state) return { state, sourcePath: candidate }
  }
  return null
}

export function normalizeActivePlanTargets(workspaceRoot: string, state: ActivePlanState): ActivePlanTarget[] {
  const directTargets = Array.isArray(state.writeTargets)
    ? state.writeTargets
    : Array.isArray(state.targets)
      ? state.targets
      : []

  return directTargets
    .map((target) => {
      const targetRepoRoot = target.targetRepoRoot?.trim() || resolveTargetProjectRoot(workspaceRoot, {
        targetRepoRoot: target.targetRepoRoot,
        planPath: target.planPath,
        specPath: target.specPath,
        contextPath: target.contextPath,
      }) || undefined

      return {
        ...target,
        targetRepoRoot,
      }
    })
    .filter((target) => Boolean(target.targetRepoRoot && (target.planPath || target.specPath || target.contextPath)))
}

export function loadActivePlanTargets(workspaceRoot: string, hints: ActivePlanLoadHints = {}): ActivePlanTarget[] {
  const loaded = loadActivePlanState(workspaceRoot, hints)
  if (!loaded) return []
  return normalizeActivePlanTargets(workspaceRoot, loaded.state)
}

export function loadActivePlanTarget(workspaceRoot: string, hints: ActivePlanLoadHints = {}): ActivePlanTarget | null {
  return loadActivePlanTargets(workspaceRoot, hints)[0] ?? null
}

export function loadActivePlanReferenceProjects(workspaceRoot: string, hints: ActivePlanLoadHints = {}): ActivePlanReferenceProject[] {
  const loaded = loadActivePlanState(workspaceRoot, hints)
  if (!loaded) return []

  return (Array.isArray(loaded.state.referenceProjects) ? loaded.state.referenceProjects : [])
    .map((project) => ({
      ...project,
      targetRepoRoot: project.targetRepoRoot?.trim()
        || resolveTargetProjectRoot(workspaceRoot, { targetRepoRoot: project.targetRepoRoot })
        || undefined,
    }))
    .filter((project): project is ActivePlanReferenceProject => Boolean(project.targetRepoRoot))
}

export function resolveActivePlanStateFile(workspaceRoot: string, hints: ActivePlanLoadHints = {}): string {
  const loaded = loadActivePlanState(workspaceRoot, hints)
  if (loaded?.sourcePath) return loaded.sourcePath

  const projectRoot = resolveTargetProjectRoot(workspaceRoot, hints)
  if (projectRoot && hints.preferProjectState) return projectStateFile(projectRoot)
  return workspaceStateFile(workspaceRoot)
}
