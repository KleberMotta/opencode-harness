import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { loadActivePlanTarget, loadActivePlanTargets, resolvePathFromProjectRoot, resolveProjectPaths } from "../lib/j.workspace-paths"
import { featureStateTaskPaths } from "../lib/j.feature-state-paths"

// CARL v3 = Context-Aware Retrieval Layer
// Goals:
// - Preload task-scoped context for child implementer sessions before exploratory reads
// - Keep read-time enrichment for additional context discovered while working
// - Always load canonical principles when configured in the manifest
// - Rehydrate collected context during compaction

interface PrincipleEntry {
  key: string
  recall: string[]
  file: string
  priority: number
  always: boolean
}

interface DomainEntry {
  domain: string
  keywords: string[]
  files: Array<{ path: string; description: string }>
}

interface CollectedEntry {
  content: string
  priority: number
  type: "principle" | "domain"
  label: string
}

interface RuntimeTaskMetadata {
  featureSlug?: string
  taskID?: string
  planPath?: string
  targetRepoRoot?: string
  originalPrompt?: string
}

interface TaskPlanContext {
  taskID: string
  files: string[]
  contextRefs: string
  action: string
  verify: string
  done: string
}

interface PendingStartupSeed {
  prompt: string
  subagentType?: string
  featureSlug?: string
  planPath?: string
  taskID?: string
  specPath?: string
  contextPath?: string
  taskContractPath?: string
  targetRepoRoot?: string
}

type ActivePlanHints = {
  prompt?: string
  targetRepoRoot?: string
  planPath?: string
  specPath?: string
  contextPath?: string
  taskContractPath?: string
}

interface TaskContractSeed {
  featureSlug?: string
  taskID?: string
  planPath?: string
  specPath?: string
  contextPath?: string
  taskContractPath?: string
  targetRepoRoot?: string
}

const GENERIC_CARL_KEYWORDS = new Set([
  "api",
  "controller",
  "endpoint",
  "handler",
  "http",
  "integration",
  "mock",
  "request",
  "response",
  "rest",
  "route",
  "spec",
  "test",
  "tests",
  "unit",
])

const STARTUP_DOMAIN_SCORE_FLOOR_RATIO = 0.65
const FLOW_DOMAINS_WITH_BALANCE_COMPANION = new Set(["Cashout", "Orders", "Order", "Operational-entry", "Inactive-fee"])
const BALANCE_COMPANION_SIGNALS = ["available", "balance", "credit", "debit", "escrow", "loss", "reserve"]
const STARTUP_SEEDED_SUBAGENTS = new Set(["j.implementer", "j.checker", "j.planner", "j.spec-writer"])

function shouldSeedStartupPrompt(prompt: string, subagentType?: string): boolean {
  if (subagentType && STARTUP_SEEDED_SUBAGENTS.has(subagentType)) return true
  return /\bactive plan\b/i.test(prompt) || /docs\/specs\/[^\s]+\/(?:plan|spec)\.md/.test(prompt) || /\btask\s+\d+\b/i.test(prompt)
}

function parsePrinciplesManifest(content: string): PrincipleEntry[] {
  const entries: PrincipleEntry[] = []
  const lines = content.split("\n").filter((line) => !line.startsWith("#") && line.trim())

  const byKey: Record<string, Record<string, string>> = {}
  for (const line of lines) {
    const match = /^([A-Z_]+)_(STATE|RECALL|FILE|PRIORITY|ALWAYS)=(.*)$/.exec(line)
    if (!match) continue
    const [, prefix, field, value] = match
    if (!byKey[prefix]) byKey[prefix] = {}
    byKey[prefix][field] = value.trim()
  }

  for (const [key, fields] of Object.entries(byKey)) {
    if (fields["STATE"] !== "active") continue
    if (!fields["FILE"]) continue
    entries.push({
      key,
      recall: fields["RECALL"]
        ? fields["RECALL"].split(",").map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
        : [],
      file: fields["FILE"],
      priority: parseInt(fields["PRIORITY"] ?? "50", 10),
      always: /^(1|true|yes)$/i.test(fields["ALWAYS"] ?? "false"),
    })
  }

  return entries
}

function parseDomainIndex(content: string): DomainEntry[] {
  const entries: DomainEntry[] = []
  const sections = content.split(/^## /m).slice(1)

  for (const section of sections) {
    const lines = section.split("\n")
    const domain = lines[0].trim()
    const keywordsLine = lines.find((line) => line.startsWith("Keywords:"))
    const filesStart = lines.findIndex((line) => line.startsWith("Files:"))
    if (!keywordsLine || filesStart === -1) continue

    const keywords = keywordsLine
      .replace("Keywords:", "")
      .split(",")
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean)

    const files: Array<{ path: string; description: string }> = []
    for (let index = filesStart + 1; index < lines.length; index += 1) {
      const fileMatch = /^\s*-\s+([^—]+)(?:—\s+(.*))?$/.exec(lines[index])
      if (!fileMatch) break
      files.push({ path: fileMatch[1].trim(), description: fileMatch[2]?.trim() ?? "" })
    }

    entries.push({ domain, keywords, files })
  }

  return entries
}

function stripCodeBlocks(text: string): string {
  let stripped = text.replace(/\`\`\`[\s\S]*?\`\`\`/g, "")
  stripped = stripped.replace(/\`[^\`\n]+\`/g, "")
  return stripped
}

function extractKeywords(text: string): Set<string> {
  const words = new Set<string>()
  for (const word of text.split(/[^a-zA-Z0-9_-]+/).filter((candidate) => candidate.length >= 3)) {
    words.add(word.toLowerCase())
  }
  return words
}

function extractPathKeywords(filePath: string): Set<string> {
  const parts = filePath.replace(/\\/g, "/").split("/")
  const words = new Set<string>()
  for (const part of parts) {
    for (const word of part.split(/[^a-zA-Z0-9_-]+/).filter((candidate) => candidate.length >= 3)) {
      words.add(word.toLowerCase())
    }
  }
  return words
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}]/g, "\\$&")
}

function matchKeyword(keyword: string, textWords: Set<string>, rawText: string): boolean {
  if (textWords.has(keyword)) return true
  const pattern = new RegExp("\\b" + escapeRegex(keyword) + "\\b", "i")
  return pattern.test(rawText)
}

const MAX_CONTEXT_BYTES = 8000

class ContextCollector {
  private collected = new Map<string, CollectedEntry>()
  private totalBytes = 0

  has(key: string): boolean {
    return this.collected.has(key)
  }

  add(key: string, content: string, priority: number, type: "principle" | "domain", label: string): boolean {
    if (this.collected.has(key)) return false
    const size = Buffer.byteLength(content, "utf-8")
    if (this.totalBytes + size > MAX_CONTEXT_BYTES) return false

    this.collected.set(key, { content, priority, type, label })
    this.totalBytes += size
    return true
  }

  getNewEntries(keys: string[]): CollectedEntry[] {
    return keys
      .filter((key) => this.collected.has(key))
      .map((key) => this.collected.get(key)!)
      .sort((left, right) => left.priority - right.priority)
  }

  getAll(): CollectedEntry[] {
    return Array.from(this.collected.values()).sort((left, right) => left.priority - right.priority)
  }

  formatForOutput(entries: CollectedEntry[]): string {
    return entries
      .map((entry) => `[carl-inject] ${entry.type === "principle" ? "Principle" : "Domain"} (${entry.label}):\n${entry.content}`)
      .join("\n\n---\n\n")
  }
}

function routingHintsForSession(seed: PendingStartupSeed | undefined, runtime: RuntimeTaskMetadata | null): ActivePlanHints {
  return {
    prompt: seed?.prompt ?? runtime?.originalPrompt,
    targetRepoRoot: seed?.targetRepoRoot ?? runtime?.targetRepoRoot,
    planPath: seed?.planPath ?? runtime?.planPath,
    specPath: seed?.specPath,
    contextPath: seed?.contextPath,
    taskContractPath: seed?.taskContractPath,
  }
}

function activeTargetsForHints(directory: string, hints: ActivePlanHints): ReturnType<typeof loadActivePlanTargets> {
  return loadActivePlanTargets(directory, {
    preferProjectState: true,
    prompt: hints.prompt,
    targetRepoRoot: hints.targetRepoRoot,
    planPath: hints.planPath,
    specPath: hints.specPath,
    contextPath: hints.contextPath,
    taskContractPath: hints.taskContractPath,
  })
}

function activeTargetForHints(directory: string, hints: ActivePlanHints) {
  return loadActivePlanTarget(directory, {
    preferProjectState: true,
    prompt: hints.prompt,
    targetRepoRoot: hints.targetRepoRoot,
    planPath: hints.planPath,
    specPath: hints.specPath,
    contextPath: hints.contextPath,
    taskContractPath: hints.taskContractPath,
  })
}

function loadRuntimeMetadata(directory: string, sessionID: string, seed?: PendingStartupSeed): RuntimeTaskMetadata | null {
  const activeTargets = activeTargetsForHints(directory, routingHintsForSession(seed, null))
  const candidateProjectRoots = new Set<string>()
  for (const target of activeTargets) {
    if (target?.targetRepoRoot) candidateProjectRoots.add(target.targetRepoRoot)
  }

  if (candidateProjectRoots.size === 0) {
    const fallback = resolveProjectPaths(directory, activeTargetForHints(directory, routingHintsForSession(seed, null)) ?? {})
    if (fallback?.projectRoot) candidateProjectRoots.add(fallback.projectRoot)
  }

  for (const projectRoot of candidateProjectRoots) {
    const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: projectRoot })
    const specsDir = projectPaths?.specsRoot
    if (!specsDir || !existsSync(specsDir)) continue

    const featureDirs = readDirectoryNames(specsDir)
    for (const featureSlug of featureDirs) {
      const runtimePath = path.join(specsDir, featureSlug, "state", "sessions", `${sessionID}-runtime.json`)
      if (!existsSync(runtimePath)) continue
      try {
        return JSON.parse(readFileSync(runtimePath, "utf-8")) as RuntimeTaskMetadata
      } catch {
        return null
      }
    }
  }

  return null
}

function readDirectoryNames(target: string): string[] {
  try {
    return readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function resolvePlanPath(directory: string, runtime: RuntimeTaskMetadata | null, seed?: PendingStartupSeed): string | null {
  const runtimePlanPath = runtime?.planPath?.trim()
  if (runtimePlanPath) {
    const projectPaths = resolveProjectPaths(directory, {
      targetRepoRoot: runtime?.targetRepoRoot,
      planPath: runtimePlanPath,
    })
    return path.isAbsolute(runtimePlanPath)
      ? runtimePlanPath
      : projectPaths
        ? resolvePathFromProjectRoot(projectPaths.projectRoot, runtimePlanPath)
        : path.join(directory, runtimePlanPath)
  }

  const activePlan = activeTargetForHints(directory, routingHintsForSession(seed, runtime))
  if (!activePlan) return null
  try {
    const relativePath = activePlan.planPath?.trim()
    if (!relativePath) return null
    const projectPaths = resolveProjectPaths(directory, {
      targetRepoRoot: activePlan.targetRepoRoot,
      planPath: relativePath,
      specPath: activePlan.specPath,
      contextPath: activePlan.contextPath,
    })
    return path.isAbsolute(relativePath)
      ? relativePath
      : projectPaths
        ? resolvePathFromProjectRoot(projectPaths.projectRoot, relativePath)
        : path.join(directory, relativePath)
  } catch {
    return null
  }
}

function extractFeatureSlugFromPath(filePath: string): string | null {
  return filePath.match(/docs\/specs\/([^/]+)\//)?.[1] ?? null
}

function extractFeatureSlugFromPrompt(prompt: string): string | null {
  return prompt.match(/docs\/specs\/([^/]+)\//)?.[1] ?? null
}

function extractPlanPathFromPrompt(prompt: string): string | null {
  return prompt.match(/docs\/specs\/[^\s]+\/plan\.md/)?.[0] ?? null
}

function readIfExists(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, "utf-8") : ""
}

function loadTaskContractSeed(directory: string, args: Record<string, unknown>): TaskContractSeed | null {
  const contractArg = typeof args.contract === "object" && args.contract
    ? (args.contract as Record<string, unknown>)
    : null
  if (contractArg) {
    return {
      featureSlug: typeof contractArg.featureSlug === "string" ? contractArg.featureSlug : undefined,
      taskID: typeof contractArg.taskID === "string" ? contractArg.taskID : typeof contractArg.taskID === "number" ? String(contractArg.taskID) : undefined,
      planPath: typeof contractArg.planPath === "string" ? contractArg.planPath : undefined,
      specPath: typeof contractArg.specPath === "string" ? contractArg.specPath : undefined,
      contextPath: typeof contractArg.contextPath === "string" ? contractArg.contextPath : undefined,
      taskContractPath: typeof contractArg.taskContractPath === "string" ? contractArg.taskContractPath : undefined,
      targetRepoRoot: typeof contractArg.targetRepoRoot === "string" ? contractArg.targetRepoRoot : undefined,
    }
  }

  const contractPathArg = typeof args.task_contract_path === "string"
    ? args.task_contract_path
    : typeof args.taskContractPath === "string"
      ? args.taskContractPath
      : undefined
  if (!contractPathArg) return null

  const absolutePath = path.isAbsolute(contractPathArg) ? contractPathArg : path.join(directory, contractPathArg)
  if (!existsSync(absolutePath)) return null

  try {
    const contract = JSON.parse(readFileSync(absolutePath, "utf-8")) as TaskContractSeed
    return {
      ...contract,
      taskContractPath: contractPathArg,
    }
  } catch {
    return null
  }
}

function markdownSection(body: string, title: string): string {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return body.match(new RegExp("^###\\s+" + escapedTitle + "\\s*$([\\s\\S]*?)(?=^###\\s+|^##\\s+Task\\s+|$)", "im"))?.[1]?.trim() ?? ""
}

function parseFileList(raw: string): string[] {
  return raw
    .replace(/\r/g, "")
    .split(/,|\n/)
    .map((file) => file.replace(/^\s*[-*]\s*/, "").replace(/`/g, "").trim())
    .filter(Boolean)
}

function loadTaskPlanContext(planPath: string, taskID: string | undefined): TaskPlanContext | null {
  if (!taskID || !existsSync(planPath)) return null
  const content = readFileSync(planPath, "utf-8")
  const headings = Array.from(content.matchAll(/^##\s+Task\s+([A-Za-z0-9_-]+)\b[^\n]*$/gm))
  const heading = headings.find((candidate) => candidate[1] === taskID)
  if (!heading || heading.index === undefined) return null

  const bodyStart = heading.index + heading[0].length
  const nextHeading = headings.find((candidate) => (candidate.index ?? 0) > heading.index!)
  const body = content.slice(bodyStart, nextHeading?.index ?? content.length)
  return {
    taskID,
    files: parseFileList(markdownSection(body, "Files")),
    contextRefs: markdownSection(body, "Context References"),
    action: markdownSection(body, "Action"),
    verify: markdownSection(body, "Verification"),
    done: markdownSection(body, "Done Criteria"),
  }
}

function taskSignals(runtime: RuntimeTaskMetadata | null, taskContext: TaskPlanContext | null): { keywords: Set<string>; rawText: string } {
  const texts = [
    runtime?.originalPrompt ?? "",
    taskContext?.contextRefs ?? "",
    taskContext?.action ?? "",
    taskContext?.done ?? "",
    ...(taskContext?.files ?? []),
  ]
  const rawText = texts.join(" ").toLowerCase()
  return { keywords: extractKeywords(stripCodeBlocks(rawText)), rawText }
}

function startupSeedSignals(directory: string, seed: PendingStartupSeed): { keywords: Set<string>; rawText: string } {
  const projectPaths = resolveProjectPaths(directory, {
    prompt: seed.prompt,
    targetRepoRoot: seed.targetRepoRoot,
    planPath: seed.planPath,
    specPath: seed.specPath,
    contextPath: seed.contextPath,
    taskContractPath: seed.taskContractPath,
  })
  const projectRoot = projectPaths?.projectRoot ?? directory
  const specsRoot = projectPaths?.specsRoot ?? path.join(directory, "docs", "specs")
  const resolvedPlanPath = seed.planPath
    ? path.isAbsolute(seed.planPath)
      ? seed.planPath
      : resolvePathFromProjectRoot(projectRoot, seed.planPath)
      : resolvePlanPath(directory, null, seed)
  const featureSlug = seed.featureSlug ?? (resolvedPlanPath ? extractFeatureSlugFromPath(resolvedPlanPath) : null)

  const texts = [seed.prompt]
  if (seed.taskContractPath) {
    const absoluteTaskContract = path.isAbsolute(seed.taskContractPath)
      ? seed.taskContractPath
      : resolvePathFromProjectRoot(projectRoot, seed.taskContractPath)
    texts.push(readIfExists(absoluteTaskContract))
  }
  if (resolvedPlanPath) texts.push(readIfExists(resolvedPlanPath))
  if (featureSlug) {
    texts.push(readIfExists(seed.specPath ? resolvePathFromProjectRoot(projectRoot, seed.specPath) : path.join(specsRoot, featureSlug, "spec.md")))
    texts.push(readIfExists(seed.contextPath ? resolvePathFromProjectRoot(projectRoot, seed.contextPath) : path.join(specsRoot, featureSlug, "CONTEXT.md")))
    texts.push(readIfExists(path.join(specsRoot, featureSlug, "state", "functional-validation-plan.md")))
  }

  const rawText = texts.filter(Boolean).join(" ").toLowerCase()
  return { keywords: extractKeywords(stripCodeBlocks(rawText)), rawText }
}

function isTestFocusedTask(taskContext: TaskPlanContext | null, runtime: RuntimeTaskMetadata | null): boolean {
  const fileHints = taskContext?.files ?? []
  return fileHints.some((file) => /(^|\/)src\/test\//.test(file) || /(Test|IT)\.(kt|java)$/.test(file))
}

function isTestFocusedRead(filePath: string, rawText: string): boolean {
  return /(^|\/)src\/test\//.test(filePath) || /(Test|IT)\.(kt|java)$/.test(filePath) || /@Test\b/.test(rawText)
}

function isPromptTestFocused(rawText: string): boolean {
  return /(^|\s)(src\/test\/|test\s+file|test\s+suite|unit\s+test|integration\s+test|write\s+tests?|add\s+tests?|implement\s+tests?)/.test(rawText)
}

function effectiveRecallKeywords(entry: PrincipleEntry | DomainEntry, options?: { mode?: "startup" | "read"; testFocused?: boolean }): string[] {
  const recall = "recall" in entry ? entry.recall : entry.keywords
  const mode = options?.mode ?? "read"
  if (mode === "startup") {
    if ("always" in entry && entry.always) return recall
    if ("key" in entry && entry.key === "TEST") return options?.testFocused ? recall : []
  } else if ("key" in entry && entry.key === "TEST" && options?.testFocused) {
    return recall
  }

  return recall.filter((keyword) => !GENERIC_CARL_KEYWORDS.has(keyword))
}

function addPrinciples(
  directory: string,
  collector: ContextCollector,
  keywords: Set<string>,
  rawText: string,
  options?: { includeAlways?: boolean; mode?: "startup" | "read"; testFocused?: boolean; activePlanHints?: ActivePlanHints }
): string[] {
  const targets = activeTargetsForHints(directory, options?.activePlanHints ?? {})
  const projectPathsList = targets.length > 0
    ? targets.map((t) => resolveProjectPaths(directory, t)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [resolveProjectPaths(directory, {})].filter((p): p is NonNullable<typeof p> => Boolean(p))

  const addedKeys: string[] = []
  const seenManifests = new Set<string>()

  for (const projectPaths of projectPathsList) {
    const manifestRoot = projectPaths.principlesRoot
    const manifestPathResolved = path.join(manifestRoot, "manifest")
    if (!existsSync(manifestPathResolved)) continue
    if (seenManifests.has(manifestPathResolved)) continue
    seenManifests.add(manifestPathResolved)

    const manifest = readFileSync(manifestPathResolved, "utf-8")
    const entries = parsePrinciplesManifest(manifest)

    for (const entry of entries) {
      const dedupKey = `principle:${entry.key}`
      if (collector.has(dedupKey)) continue

      const recallKeywords = effectiveRecallKeywords(entry, { mode: options?.mode, testFocused: options?.testFocused })
      const matchedRecall = recallKeywords.some((keyword) => matchKeyword(keyword, keywords, rawText))
      if (!matchedRecall && !(options?.includeAlways && entry.always)) continue

      const filePath = path.isAbsolute(entry.file)
        ? entry.file
        : resolvePathFromProjectRoot(projectPaths.projectRoot, entry.file)
      if (!existsSync(filePath)) continue

      const content = readFileSync(filePath, "utf-8")
      if (collector.add(dedupKey, content, entry.priority, "principle", entry.key)) addedKeys.push(dedupKey)
    }
  }

  return addedKeys
}

function addDomains(
  directory: string,
  collector: ContextCollector,
  keywords: Set<string>,
  rawText: string,
  options?: { mode?: "startup" | "read"; testFocused?: boolean; activePlanHints?: ActivePlanHints }
): string[] {
  const targets = activeTargetsForHints(directory, options?.activePlanHints ?? {})
  const projectPathsList = targets.length > 0
    ? targets.map((t) => resolveProjectPaths(directory, t)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [resolveProjectPaths(directory, {})].filter((p): p is NonNullable<typeof p> => Boolean(p))

  const addedKeys: string[] = []
  const seenIndexes = new Set<string>()

  for (const projectPaths of projectPathsList) {
    const domainRoot = projectPaths.domainRoot
    const indexPath = path.join(domainRoot, "INDEX.md")
    if (!existsSync(indexPath)) continue
    if (seenIndexes.has(indexPath)) continue
    seenIndexes.add(indexPath)

    const index = readFileSync(indexPath, "utf-8")
    const domains = parseDomainIndex(index)
    const scoredMatches = domains
      .map((entry) => {
        const recallKeywords = effectiveRecallKeywords(entry, { mode: options?.mode, testFocused: options?.testFocused })
        const matchedKeywords = recallKeywords.filter((keyword) => matchKeyword(keyword, keywords, rawText))
        return {
          entry,
          matchedKeywords,
          score: matchedKeywords.reduce((sum, keyword) => sum + Math.max(keyword.length, 1), 0),
        }
      })
      .filter((candidate) => candidate.matchedKeywords.length > 0)

    let allowedDomains: Set<string> | null = null
    if ((options?.mode ?? "read") === "startup" && scoredMatches.length > 0) {
      const bestScore = Math.max(...scoredMatches.map((candidate) => candidate.score))
      allowedDomains = new Set(
        scoredMatches
          .filter((candidate) => candidate.score >= bestScore * STARTUP_DOMAIN_SCORE_FLOOR_RATIO)
          .map((candidate) => candidate.entry.domain)
      )

      const bestDomains = scoredMatches.filter((candidate) => candidate.score === bestScore).map((candidate) => candidate.entry.domain)
      const hasFlowWinner = bestDomains.some((domain) => FLOW_DOMAINS_WITH_BALANCE_COMPANION.has(domain))
      const balanceCandidate = scoredMatches.find((candidate) => candidate.entry.domain.toLowerCase() === "balance")
      const hasBalanceSignals = BALANCE_COMPANION_SIGNALS.some((signal) => rawText.includes(signal))
      if (hasFlowWinner && balanceCandidate && hasBalanceSignals) {
        allowedDomains.add(balanceCandidate.entry.domain)
      }
    }

    for (const entry of domains) {
      if (allowedDomains && !allowedDomains.has(entry.domain)) continue
      const recallKeywords = effectiveRecallKeywords(entry, { mode: options?.mode, testFocused: options?.testFocused })
      const matched = recallKeywords.some((keyword) => matchKeyword(keyword, keywords, rawText))
      if (!matched) continue

      for (const file of entry.files.slice(0, 3)) {
        const dedupKey = `domain:${entry.domain}:${file.path}`
        if (collector.has(dedupKey)) continue

        const domainPath = path.join(domainRoot, file.path)
        if (!existsSync(domainPath)) continue

        const content = readFileSync(domainPath, "utf-8")
        if (collector.add(dedupKey, content, 10, "domain", `${entry.domain} / ${file.path}`)) addedKeys.push(dedupKey)
      }
    }
  }

  return addedKeys
}

export default (async ({ directory }: { directory: string }) => {
  const collectorsBySession = new Map<string, ContextCollector>()
  const taskKeywordsLoaded = new Set<string>()
  const preloadedSessions = new Set<string>()
  const pendingStartupSeedsByParent = new Map<string, PendingStartupSeed[]>()
  const startupSeedBySession = new Map<string, PendingStartupSeed>()

  function collectorForSession(sessionID: string): ContextCollector {
    let collector = collectorsBySession.get(sessionID)
    if (!collector) {
      collector = new ContextCollector()
      collectorsBySession.set(sessionID, collector)
    }
    return collector
  }

  function loadTaskKeywords(sessionID: string): Set<string> {
    if (taskKeywordsLoaded.has(sessionID)) return new Set()
    taskKeywordsLoaded.add(sessionID)

    // Try task-scoped execution state first (feature/task-local)
    const seed = startupSeedBySession.get(sessionID)
    const runtime = loadRuntimeMetadata(directory, sessionID, seed)
    if (runtime?.featureSlug && runtime?.taskID) {
      const taskPaths = featureStateTaskPaths(directory, runtime.featureSlug, runtime.taskID, {
        targetRepoRoot: runtime.targetRepoRoot,
      })
      if (existsSync(taskPaths.statePath)) {
        const state = readFileSync(taskPaths.statePath, "utf-8")
        const goalMatch = /\*\*Goal\*\*:\s*(.+)/i.exec(state)
        const taskLines = state.split("\n").filter((line) => /^\s*-\s*\[/.test(line))
        const taskText = [goalMatch?.[1] ?? "", ...taskLines].join(" ")
        return extractKeywords(stripCodeBlocks(taskText))
      }
    }

    // Fallback to workspace-global state for backward compatibility
    const statePath = path.join(directory, ".opencode", "state", "execution-state.md")
    if (!existsSync(statePath)) return new Set()

    const state = readFileSync(statePath, "utf-8")
    const goalMatch = /\*\*Goal\*\*:\s*(.+)/i.exec(state)
    const taskLines = state.split("\n").filter((line) => /^\s*-\s*\[/.test(line))
    const taskText = [goalMatch?.[1] ?? "", ...taskLines].join(" ")
    return extractKeywords(stripCodeBlocks(taskText))
  }

  function injectTaskScopedContext(sessionID: string): CollectedEntry[] {
    const collector = collectorForSession(sessionID)
    const seed = startupSeedBySession.get(sessionID)
    const runtime = loadRuntimeMetadata(directory, sessionID, seed)
    const planPath = resolvePlanPath(directory, runtime, seed)
    const taskContext = planPath ? loadTaskPlanContext(planPath, runtime?.taskID) : null
    const signals = taskSignals(runtime, taskContext)
    const testFocused = isTestFocusedTask(taskContext, runtime)
    const activePlanHints = routingHintsForSession(seed, runtime)
    const addedKeys = [
      ...addPrinciples(directory, collector, signals.keywords, signals.rawText, { includeAlways: true, mode: "startup", testFocused, activePlanHints }),
      ...addDomains(directory, collector, signals.keywords, signals.rawText, { mode: "startup", testFocused, activePlanHints }),
    ]
    return collector.getNewEntries(addedKeys)
  }

  function hasTaskScopedRuntime(sessionID: string): boolean {
    const seed = startupSeedBySession.get(sessionID)
    return Boolean(loadRuntimeMetadata(directory, sessionID, seed)?.taskID)
  }

  function injectMainAgentStartupContext(sessionID: string): CollectedEntry[] {
    const seed = startupSeedBySession.get(sessionID)
    if (!seed) return []

    const collector = collectorForSession(sessionID)
    const signals = startupSeedSignals(directory, seed)
    const testFocused = isPromptTestFocused(signals.rawText)
    const activePlanHints = routingHintsForSession(seed, null)
    const addedKeys = [
      ...addPrinciples(directory, collector, signals.keywords, signals.rawText, { includeAlways: true, mode: "startup", testFocused, activePlanHints }),
      ...addDomains(directory, collector, signals.keywords, signals.rawText, { mode: "startup", testFocused, activePlanHints }),
    ]
    return collector.getNewEntries(addedKeys)
  }

  function renderStartupContext(entries: CollectedEntry[], collector: ContextCollector, scope: "task" | "session"): string | null {
    const injected = entries.length > 0 ? entries : collector.getAll()
    if (injected.length === 0) return null

    return (
      `[carl-inject] ${scope === "task" ? "Task-scoped" : "Delegated session"} startup context. Use this before searching the repo or opening README/principles/domain docs:\n\n` +
      collector.formatForOutput(injected)
    )
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      if (event.type !== "session.created") return
      const sessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
      if (!sessionID) return
      const info = typeof event.properties?.info === "object" && event.properties.info
        ? (event.properties.info as Record<string, unknown>)
        : undefined
      const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
      if (parentID) {
        const queue = pendingStartupSeedsByParent.get(parentID)
        const seed = queue?.shift()
        if (seed) {
          startupSeedBySession.set(sessionID, seed)
          if (queue && queue.length > 0) pendingStartupSeedsByParent.set(parentID, queue)
          else pendingStartupSeedsByParent.delete(parentID)
        }
      }
      injectTaskScopedContext(sessionID)
      injectMainAgentStartupContext(sessionID)
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return

      const subagentType = typeof output.args?.subagent_type === "string"
        ? output.args.subagent_type
        : typeof output.args?.subagentType === "string"
          ? output.args.subagentType
          : undefined
      const prompt = typeof output.args?.prompt === "string" ? output.args.prompt.trim() : ""
      if (!prompt) return
      if (!shouldSeedStartupPrompt(prompt, subagentType)) return
      const taskContract = loadTaskContractSeed(directory, output.args)

      const queue = pendingStartupSeedsByParent.get(input.sessionID) ?? []
      queue.push({
        prompt,
        subagentType,
        featureSlug: taskContract?.featureSlug ?? extractFeatureSlugFromPrompt(prompt) ?? undefined,
        taskID: taskContract?.taskID,
        targetRepoRoot: taskContract?.targetRepoRoot,
        planPath: taskContract?.planPath ?? extractPlanPathFromPrompt(prompt) ?? undefined,
        specPath: taskContract?.specPath,
        contextPath: taskContract?.contextPath,
        taskContractPath: taskContract?.taskContractPath,
      })
      pendingStartupSeedsByParent.set(input.sessionID, queue)
    },

    "chat.message": async (
      input: { sessionID: string },
      output: { message: { system?: string }; parts: unknown[] }
    ) => {
      if (preloadedSessions.has(input.sessionID)) return

      const collector = collectorForSession(input.sessionID)
      const taskScoped = hasTaskScopedRuntime(input.sessionID)
      const taskEntries = taskScoped ? injectTaskScopedContext(input.sessionID) : []
      const scope = taskScoped ? "task" : "session"
      const newEntries = taskScoped ? taskEntries : injectMainAgentStartupContext(input.sessionID)
      const rendered = renderStartupContext(newEntries, collector, scope)
      if (!rendered) return

      output.message.system = output.message.system ? `${output.message.system}\n\n${rendered}` : rendered
      preloadedSessions.add(input.sessionID)
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (input.tool !== "Read") return

      const filePath: string = input.args?.path ?? input.args?.file_path ?? ""
      if (!filePath) return

      const allKeywords = new Set<string>()
      const taskKeywords = loadTaskKeywords(input.sessionID)
      for (const keyword of taskKeywords) allKeywords.add(keyword)

      const fileContent = output.output ?? ""
      const strippedContent = stripCodeBlocks(fileContent)
      const contentKeywords = extractKeywords(strippedContent)
      for (const keyword of contentKeywords) allKeywords.add(keyword)

      const pathKeywords = extractPathKeywords(filePath)
      for (const keyword of pathKeywords) allKeywords.add(keyword)

      if (allKeywords.size === 0) return

      const rawSignal = [
        strippedContent,
        filePath,
        ...Array.from(taskKeywords),
        ...Array.from(pathKeywords),
      ].join(" ").toLowerCase()
      const testFocused = isTestFocusedRead(filePath, rawSignal)

      const collector = collectorForSession(input.sessionID)
      const seed = startupSeedBySession.get(input.sessionID)
      const runtime = loadRuntimeMetadata(directory, input.sessionID, seed)
      const activePlanHints = routingHintsForSession(seed, runtime)
      const addedKeys = [
        ...addPrinciples(directory, collector, allKeywords, rawSignal, { includeAlways: true, mode: "read", testFocused, activePlanHints }),
        ...addDomains(directory, collector, allKeywords, rawSignal, { mode: "read", testFocused, activePlanHints }),
      ]
      if (addedKeys.length === 0) return

      const newEntries = collector.getNewEntries(addedKeys)
      if (newEntries.length > 0) output.output += "\n\n" + collector.formatForOutput(newEntries)
    },

    "experimental.session.compacting": async (
      input: { sessionID?: string },
      output: { context: string[]; prompt?: string }
    ) => {
      if (!input.sessionID) return

      const collector = collectorsBySession.get(input.sessionID)
      if (!collector) return

      const all = collector.getAll()
      if (all.length === 0) return

      output.context.push(
        "[carl-inject] Previously injected context (principles + domain docs):\n\n" +
          collector.formatForOutput(all)
      )
    },
  }
}) satisfies Plugin
