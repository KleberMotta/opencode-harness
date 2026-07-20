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
  planPath?: string
  specPath?: string
  contextPath?: string
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
  ".context",
  "build",
  "dist",
  "node_modules",
  "target",
  "tmp",
])

// First-level workspace dirs that are harness/infra, never product repositories.
// Shared canon contexts live below {workspace}/contexts/<context-name>/.
export const CONTEXT_SPECIAL_DIRS = new Set([".opencode", "contexts", "docs", "tmp", "node_modules"])
export const CONTEXTS_DIR = "contexts"

const discoveryCache = new Map<string, string[]>()

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

function looksLikeProjectRoot(directory: string): boolean {
  if (!existsSync(directory)) return false
  return existsSync(path.join(directory, ".git")) || (existsSync(path.join(directory, "opencode.json")) && existsSync(path.join(directory, "docs")))
}

function walkProjects(current: string, depth: number, found: Set<string>, workspaceRoot: string): void {
  if (depth < 0 || !existsSync(current)) return
  const contextsRoot = path.join(workspaceRoot, CONTEXTS_DIR)
  // The workspace root is the harness repository, not a product target. Keep
  // walking below it so product repositories such as olxbr/trp-seller-api are
  // discoverable even though the workspace itself has a .git directory.
  if (current !== workspaceRoot && current !== contextsRoot && looksLikeProjectRoot(current)) {
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
    if (current === workspaceRoot && CONTEXT_SPECIAL_DIRS.has(entry.name) && entry.name !== CONTEXTS_DIR) continue
    walkProjects(path.join(current, entry.name), depth - 1, found, workspaceRoot)
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
  walkProjects(workspaceRoot, 4, found, workspaceRoot)

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

// Canon contexts are filesystem markers, not names. Any directory below
// {workspace}/contexts may define shared canon by containing `.context/`.
// Product repositories live as siblings of that marker. A repo inherits every
// ancestor marker up to contexts/, nearest first for precedence.
export function contextRootsForFile(workspaceRoot: string, filePath: string): string[] {
  if (!filePath) return []
  const contextsRoot = path.join(path.resolve(workspaceRoot), CONTEXTS_DIR)
  const absolutePath = path.resolve(filePath)
  // Only files under {workspace}/contexts inherit canon. Guard on the file
  // itself, not on the containing repo: a file inside a `.context/` resolves to
  // the contexts repo's own .git, whose parent is the workspace root.
  if (!absolutePath.startsWith(contextsRoot + path.sep) && absolutePath !== contextsRoot) return []

  const relativeToContexts = normalizePath(path.relative(contextsRoot, absolutePath))
  const pathSegments = relativeToContexts.split("/")
  const markerIndex = pathSegments.lastIndexOf(".context")

  const roots: string[] = []
  let current: string
  if (markerIndex >= 0) {
    // The target lives inside a `.context/`; that marker is the nearest canon.
    const marker = path.join(contextsRoot, ...pathSegments.slice(0, markerIndex + 1))
    roots.push(marker)
    current = path.dirname(marker)
  } else {
    // Product file: start at the containing repo's parent so the repo's own
    // subtree cannot shadow a sibling `.context`. When the path is not inside a
    // nested product repo, findContainingProjectRoot overshoots to the contexts
    // repo itself — fall back to the file's own directory then.
    const projectRoot = findContainingProjectRoot(workspaceRoot, filePath)
    current = projectRoot && projectRoot !== contextsRoot ? path.dirname(projectRoot) : path.dirname(absolutePath)
  }

  while (current.startsWith(contextsRoot)) {
    const marker = path.join(current, ".context")
    if (existsSync(marker) && !roots.includes(marker)) roots.push(marker)
    if (current === contextsRoot) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

export function discoverContextRoots(workspaceRoot: string): string[] {
  const contextsRoot = path.join(path.resolve(workspaceRoot), CONTEXTS_DIR)
  const found: string[] = []

  function walk(current: string) {
    if (!existsSync(current)) return
    if (current !== contextsRoot && existsSync(path.join(current, ".git"))) return
    const marker = path.join(current, ".context")
    if (existsSync(marker)) found.push(marker)

    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue
      walk(path.join(current, entry.name))
    }
  }

  walk(contextsRoot)
  return uniqueSorted(found)
}

export function findContextRoot(workspaceRoot: string, filePath: string): string | null {
  return contextRootsForFile(workspaceRoot, filePath)[0] ?? null
}

export function contextAssetsDir(contextRoot: string | null | undefined): string | null {
  return contextRoot && existsSync(contextRoot) ? contextRoot : null
}

// Backward-compatible name for callers that previously modeled a dedicated
// project overlay. The nearest `.context` is the project-containing canon.
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

export function resolveProjectPaths(workspaceRoot: string, hints: ProjectHints = {}): ProjectPaths | null {
  const projectRoot = resolveTargetProjectRoot(workspaceRoot, hints)
  if (!projectRoot) return null

  return {
    workspaceRoot,
    harnessRoot: path.join(workspaceRoot, ".opencode"),
    projectRoot,
    stateRoot: path.join(workspaceRoot, ".opencode", "state"),
    docsRoot: path.join(projectRoot, "docs"),
    specsRoot: path.join(workspaceRoot, "docs", "specs"),
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

  // Top-level spec paths from the new centralized structure (workspace-relative)
  const topLevelPlanPath = state.planPath
  const topLevelSpecPath = state.specPath
  const topLevelContextPath = state.contextPath

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
        // Inherit top-level paths when per-target paths are missing (new centralized structure)
        planPath: target.planPath || topLevelPlanPath,
        specPath: target.specPath || topLevelSpecPath,
        contextPath: target.contextPath || topLevelContextPath,
        slug: target.slug || state.slug,
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
