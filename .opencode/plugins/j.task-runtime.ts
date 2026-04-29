import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import {
  ensureFeatureStateStructure,
  featureStateSessionRuntimePath,
  featureStateTaskPaths,
} from "../lib/j.feature-state-paths"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { resolveStateFile } from "../lib/j.state-paths"
import { loadActivePlanTarget, loadActivePlanTargets, resolveProjectPaths } from "../lib/j.workspace-paths"

type RuntimeTaskMetadata = {
  featureSlug: string
  taskID: string
  attempt: number
  stage: "implement" | "validate" | "check-reentry"
  planBranch: string
  planPath: string
  specPath: string
  contextPath: string
  statePath: string
  retryStatePath: string
  runtimePath: string
  taskContractPath: string
  targetRepoRoot: string
  parentSessionID: string
  ownerSessionID?: string
  ownerSessionTitle?: string
  originalPrompt: string
}

type ActivePlanContract = {
  slug?: string
  planPath?: string
  specPath?: string
  contextPath?: string
  workflowContractPath?: string
  targetRepoRoot?: string
  writeTargets?: Array<{
    project?: string
    planPath?: string
    specPath?: string
    contextPath?: string
    targetRepoRoot?: string
  }>
}

type TaskContract = {
  featureSlug?: string
  taskID?: string
  attempt?: number
  stage?: RuntimeTaskMetadata["stage"]
  planPath?: string
  specPath?: string
  contextPath?: string
  taskContractPath?: string
  targetRepoRoot?: string
}

type PersistedTaskContract = {
  featureSlug: string
  taskID: string
  attempt: number
  stage: RuntimeTaskMetadata["stage"]
  planPath: string
  specPath: string
  contextPath: string
  taskContractPath: string
  targetRepoRoot: string
  parentSessionID: string
  ownerSessionID?: string
  ownerSessionTitle?: string
  originalPrompt: string
}

type RetryState = {
  taskId: number
  attempt: number
  automaticRetriesUsed: number
  lastUpdatedAt: string
  lastReason?: string
  abortedSessionId?: string
  retriedFromAttempt?: number
}

type TrackedSession = {
  metadata: RuntimeTaskMetadata
  startedAtMs: number
  lastEventAtMs: number
}

type SessionStatus = { type: "idle" | "retry" | "busy" }

type SessionStatusMap = Record<string, SessionStatus>

type RuntimeRecord = {
  taskId?: number
  taskID?: string
  featureSlug?: string
  attempt?: number
  branch?: string
  planBranch?: string
  status?: string
  sessionId?: string
  ownerSessionID?: string
  startedAt?: string
  lastHeartbeat?: string
  stage?: RuntimeTaskMetadata["stage"]
  planPath?: string
  specPath?: string
  contextPath?: string
  statePath?: string
  retryStatePath?: string
  runtimePath?: string
  taskContractPath?: string
  targetRepoRoot?: string
  parentSessionID?: string
  ownerSessionTitle?: string
  originalPrompt?: string
}

const MAX_AUTOMATIC_RETRIES = 1
const TASK_START_TIMEOUT_MS = 2 * 60 * 1000
const IMPLEMENT_STALE_MS = 5 * 60 * 1000
const VALIDATE_STALE_MS = 3 * 60 * 1000
const BUSY_GRACE_MULTIPLIER = 2
const WATCHDOG_POLL_MS = 30 * 1000

function toRepoRelative(directory: string, filePath: string): string {
  return path.relative(directory, filePath) || "."
}

function toProjectRelative(projectRoot: string, filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) || "." : filePath
}

function absoluteFromWorkspace(directory: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(directory, filePath)
}

function isoNow(): string {
  return new Date().toISOString()
}

function extractFeatureSlug(prompt: string): string | null {
  return prompt.match(/docs\/specs\/([^/]+)\//)?.[1] ?? null
}

function extractPlanPath(prompt: string): string | null {
  return prompt.match(/(?:[\w.-]+\/)+docs\/specs\/[^\s]+\/plan\.md|docs\/specs\/[^\s]+\/plan\.md/)?.[0] ?? null
}

function extractFeatureSlugFromPlanPath(planPath: string): string | null {
  return planPath.match(/docs\/specs\/([^/]+)\//)?.[1] ?? null
}

function extractStructuredString(prompt: string, label: string): string | null {
  const match = prompt.match(new RegExp(`^${label}:\\s*(.+)$`, "im"))?.[1]?.trim()
  return match && match.length > 0 ? match : null
}

function extractTaskID(prompt: string): string | null {
  const explicitTask = extractStructuredString(prompt, "Task")
  if (explicitTask?.match(/^\d+$/)) return explicitTask
  return prompt.match(/(?:Execute|executing|Validate|validating) task\s+(\d+)\b/i)?.[1] ?? null
}

function extractStage(prompt: string): RuntimeTaskMetadata["stage"] {
  const explicitStage = extractStructuredString(prompt, "Stage")?.toLowerCase()
  if (explicitStage === "validate") return "validate"
  if (explicitStage === "check-reentry") return "check-reentry"
  if (explicitStage === "implement") return "implement"

  const firstMeaningfulLine = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
  if (/^validate\s+task\b/i.test(firstMeaningfulLine)) return "validate"
  if (/^execute\s+task\b/i.test(firstMeaningfulLine)) return "implement"
  if (/\bvalidate\b|\bvalidator\b/i.test(prompt)) return "validate"
  if (/check-review\.md|check-all-output\.txt|functional-validation-plan\.md/i.test(prompt)) return "check-reentry"
  return "implement"
}

function extractAttempt(prompt: string): number {
  const raw = prompt.match(/Attempt:\s*(\d+)/i)?.[1]
  return raw ? Number.parseInt(raw, 10) : 1
}

function loadActivePlan(directory: string): ActivePlanContract | null {
  const activePlanFile = resolveStateFile(directory, "active-plan.json")
  if (!existsSync(activePlanFile)) return null

  try {
    const parsed = JSON.parse(readFileSync(activePlanFile, "utf-8")) as ActivePlanContract
    const primary = loadActivePlanTarget(directory)
    return {
      ...parsed,
      ...(primary ?? {}),
      writeTargets: loadActivePlanTargets(directory),
    }
  } catch {
    return null
  }
}

function selectMatchingWriteTarget(prompt: string, activePlan: ActivePlanContract | null) {
  const targets = Array.isArray(activePlan?.writeTargets) ? activePlan.writeTargets : []
  if (targets.length <= 1) return null

  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) return null

  const scored = targets.map((target) => {
    const repoRoot = target.targetRepoRoot?.trim()
    const planPath = target.planPath?.trim()
    const specPath = target.specPath?.trim()
    const contextPath = target.contextPath?.trim()
    const project = target.project?.trim()
    let score = 0

    if (repoRoot && normalizedPrompt.includes(repoRoot)) score += 100
    if (project && normalizedPrompt.includes(project)) score += 50
    if (planPath && normalizedPrompt.includes(planPath)) score += 10
    if (specPath && normalizedPrompt.includes(specPath)) score += 5
    if (contextPath && normalizedPrompt.includes(contextPath)) score += 5

    return { target, score }
  })

  scored.sort((left, right) => right.score - left.score)
  return scored[0]?.score ? scored[0].target : null
}

function loadTaskContract(directory: string, args: Record<string, unknown>): TaskContract | null {
  const contractArg = typeof args.contract === "object" && args.contract
    ? (args.contract as Record<string, unknown>)
    : null

  if (contractArg) {
    return {
      featureSlug: typeof contractArg.featureSlug === "string" ? contractArg.featureSlug : undefined,
      taskID: typeof contractArg.taskID === "string" ? contractArg.taskID : typeof contractArg.taskID === "number" ? String(contractArg.taskID) : undefined,
      attempt: typeof contractArg.attempt === "number" ? contractArg.attempt : undefined,
      stage: contractArg.stage === "implement" || contractArg.stage === "validate" || contractArg.stage === "check-reentry"
        ? contractArg.stage
        : undefined,
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
    const contract = JSON.parse(readFileSync(absolutePath, "utf-8")) as TaskContract
    return {
      ...contract,
      taskContractPath: contractPathArg,
    }
  } catch {
    return null
  }
}

function buildMetadata(directory: string, parentSessionID: string, prompt: string, args: Record<string, unknown>): RuntimeTaskMetadata | null {
  const config = loadJuninhoConfig(directory)
  if (config.workflow?.implement?.watchdogSessionStale === false) return null

  const activePlan = loadActivePlan(directory)
  const taskContract = loadTaskContract(directory, args)
  const matchedTarget = selectMatchingWriteTarget(prompt, activePlan)
  const promptPlanPath = extractPlanPath(prompt)
  const planPath = taskContract?.planPath?.trim() ?? promptPlanPath ?? matchedTarget?.planPath?.trim() ?? activePlan?.planPath?.trim() ?? null
  const featureSlug = taskContract?.featureSlug?.trim() ?? extractFeatureSlug(prompt) ?? activePlan?.slug?.trim() ?? (planPath ? extractFeatureSlugFromPlanPath(planPath) : null)
  const taskID = taskContract?.taskID?.trim() ?? extractTaskID(prompt)
  if (!featureSlug || !taskID) return null

  const projectPaths = resolveProjectPaths(directory, {
    prompt,
    targetRepoRoot: taskContract?.targetRepoRoot?.trim() || matchedTarget?.targetRepoRoot?.trim() || activePlan?.targetRepoRoot,
    planPath: planPath ?? undefined,
    specPath: taskContract?.specPath?.trim() || matchedTarget?.specPath?.trim() || activePlan?.specPath?.trim(),
    contextPath: taskContract?.contextPath?.trim() || matchedTarget?.contextPath?.trim() || activePlan?.contextPath?.trim(),
    taskContractPath: taskContract?.taskContractPath?.trim(),
  })
  if (!projectPaths) return null

  ensureFeatureStateStructure(directory, featureSlug, { targetRepoRoot: projectPaths.projectRoot })
  const taskPaths = featureStateTaskPaths(directory, featureSlug, taskID, { targetRepoRoot: projectPaths.projectRoot })
  mkdirSync(taskPaths.taskDir, { recursive: true })

  const taskContractPath = toProjectRelative(
    projectPaths.projectRoot,
    taskContract?.taskContractPath?.trim() || taskPaths.contractPath
  )

  return {
    featureSlug,
    taskID,
    attempt: taskContract?.attempt ?? extractAttempt(prompt),
    stage: taskContract?.stage ?? extractStage(prompt),
    planBranch: "feature/" + featureSlug,
    planPath: toProjectRelative(projectPaths.projectRoot, planPath || `docs/specs/${featureSlug}/plan.md`),
    specPath: toProjectRelative(projectPaths.projectRoot, taskContract?.specPath?.trim() || matchedTarget?.specPath?.trim() || activePlan?.specPath?.trim() || `docs/specs/${featureSlug}/spec.md`),
    contextPath: toProjectRelative(projectPaths.projectRoot, taskContract?.contextPath?.trim() || matchedTarget?.contextPath?.trim() || activePlan?.contextPath?.trim() || `docs/specs/${featureSlug}/CONTEXT.md`),
    statePath: toRepoRelative(directory, taskPaths.statePath),
    retryStatePath: toRepoRelative(directory, taskPaths.retryStatePath),
    runtimePath: toRepoRelative(directory, taskPaths.runtimePath),
    taskContractPath,
    targetRepoRoot: projectPaths.projectRoot,
    parentSessionID,
    originalPrompt: prompt,
  }
}

function sessionRuntimePath(directory: string, metadata: RuntimeTaskMetadata, sessionID: string): string {
  return featureStateSessionRuntimePath(directory, metadata.featureSlug, sessionID, { targetRepoRoot: metadata.targetRepoRoot })
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function writeMetadata(filePath: string, metadata: RuntimeTaskMetadata): void {
  const existing = readJsonFile<RuntimeRecord>(filePath) ?? {}
  const sessionChanged = existing.attempt !== metadata.attempt
    || existing.ownerSessionID !== metadata.ownerSessionID
    || existing.sessionId !== metadata.ownerSessionID
  const now = isoNow()
  const next: RuntimeRecord = {
    ...existing,
    taskId: existing.taskId ?? Number.parseInt(metadata.taskID, 10),
    taskID: metadata.taskID,
    featureSlug: metadata.featureSlug,
    attempt: metadata.attempt,
    branch: existing.branch ?? metadata.planBranch,
    planBranch: metadata.planBranch,
    status: sessionChanged ? undefined : existing.status,
    sessionId: metadata.ownerSessionID ?? existing.sessionId,
    ownerSessionID: metadata.ownerSessionID,
    startedAt: sessionChanged ? now : existing.startedAt,
    lastHeartbeat: sessionChanged ? now : existing.lastHeartbeat,
    stage: metadata.stage,
    planPath: metadata.planPath,
    specPath: metadata.specPath,
    contextPath: metadata.contextPath,
    statePath: metadata.statePath,
    retryStatePath: metadata.retryStatePath,
    runtimePath: metadata.runtimePath,
    taskContractPath: metadata.taskContractPath,
    targetRepoRoot: metadata.targetRepoRoot,
    parentSessionID: metadata.parentSessionID,
    ownerSessionTitle: metadata.ownerSessionTitle,
    originalPrompt: metadata.originalPrompt,
  }
  writeJsonFile(filePath, next)
}

function writeTaskContract(directory: string, metadata: RuntimeTaskMetadata): void {
  const contractPath = path.join(metadata.targetRepoRoot, metadata.taskContractPath)
  const payload: PersistedTaskContract = {
    featureSlug: metadata.featureSlug,
    taskID: metadata.taskID,
    attempt: metadata.attempt,
    stage: metadata.stage,
    planPath: metadata.planPath,
    specPath: metadata.specPath,
    contextPath: metadata.contextPath,
    taskContractPath: metadata.taskContractPath,
    targetRepoRoot: metadata.targetRepoRoot,
    parentSessionID: metadata.parentSessionID,
    ownerSessionID: metadata.ownerSessionID,
    ownerSessionTitle: metadata.ownerSessionTitle,
    originalPrompt: metadata.originalPrompt,
  }
  writeJsonFile(contractPath, payload)
}

function readExecutionState(filePath: string): { status?: string; attempt?: number; lastHeartbeat?: string } {
  if (!existsSync(filePath)) return {}
  const content = readFileSync(filePath, "utf-8")
  const status = content.match(/\*\*Status\*\*:\s*([^\n]+)/)?.[1]?.trim()
  const attemptRaw = content.match(/\*\*Attempt\*\*:\s*(\d+)/)?.[1]
  const lastHeartbeat = content.match(/\*\*Last heartbeat\*\*:\s*([^\n]+)/)?.[1]?.trim()
  return {
    status,
    attempt: attemptRaw ? Number.parseInt(attemptRaw, 10) : undefined,
    lastHeartbeat,
  }
}

function readRuntimeStatus(filePath: string): { status?: string; attempt?: number; lastHeartbeat?: string; sessionID?: string } {
  const parsed = readJsonFile<RuntimeRecord>(filePath)
  if (!parsed) return {}
  return {
    status: parsed.status,
    attempt: typeof parsed.attempt === "number" ? parsed.attempt : undefined,
    lastHeartbeat: parsed.lastHeartbeat,
    sessionID: parsed.sessionId ?? parsed.ownerSessionID,
  }
}

function writeRuntimeStatus(filePath: string, patch: Partial<RuntimeRecord>): void {
  const existing = readJsonFile<RuntimeRecord>(filePath) ?? {}
  const next: RuntimeRecord = {
    ...existing,
    ...patch,
  }
  writeJsonFile(filePath, next)
}

function readRetryState(filePath: string, taskID: string, attempt: number): RetryState {
  const existing = readJsonFile<RetryState>(filePath)
  return {
    taskId: Number.parseInt(taskID, 10),
    attempt,
    automaticRetriesUsed: existing?.automaticRetriesUsed ?? 0,
    lastUpdatedAt: existing?.lastUpdatedAt ?? isoNow(),
    lastReason: existing?.lastReason,
    abortedSessionId: existing?.abortedSessionId,
    retriedFromAttempt: existing?.retriedFromAttempt,
  }
}

function writeRetryState(filePath: string, next: RetryState): void {
  writeJsonFile(filePath, {
    ...next,
    lastUpdatedAt: isoNow(),
  })
}

function markSupersededExecutionState(filePath: string, attempt: number): void {
  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, "utf-8")
  const nextContent = content
    .replace(/(\*\*Status\*\*:\s*)([^\n]+)/, `$1SUPERSEDED`)
    .replace(/(\*\*Last heartbeat\*\*:\s*)([^\n]+)/, `$1${isoNow()}`)
  const retryLine = `- **Retry of**: ${attempt}`
  const finalContent = nextContent.includes("**Retry of**:")
    ? nextContent.replace(/(\*\*Retry of\*\*:\s*)([^\n]+)/, `$1${attempt}`)
    : nextContent.replace(/(\*\*Depends on\*\*:[^\n]*\n)/, `$1${retryLine}\n`)
  writeFileSync(filePath, finalContent, "utf-8")
}

function maybeMarkSupersededExecutionState(filePath: string, attempt: number, refreshExecutionHeartbeat: boolean): void {
  if (refreshExecutionHeartbeat) {
    markSupersededExecutionState(filePath, attempt)
    return
  }

  if (!existsSync(filePath)) return
  const content = readFileSync(filePath, "utf-8")
  const nextContent = content.replace(/(\*\*Status\*\*:\s*)([^\n]+)/, `$1SUPERSEDED`)
  const retryLine = `- **Retry of**: ${attempt}`
  const finalContent = nextContent.includes("**Retry of**:")
    ? nextContent.replace(/(\*\*Retry of\*\*:\s*)([^\n]+)/, `$1${attempt}`)
    : nextContent.replace(/(\*\*Depends on\*\*:[^\n]*\n)/, `$1${retryLine}\n`)
  writeFileSync(filePath, finalContent, "utf-8")
}

function isTerminalStatus(status?: string): boolean {
  return status === "COMPLETE" || status === "FAILED" || status === "BLOCKED" || status === "SUPERSEDED"
}

function parseStaleThresholdMs(stage: RuntimeTaskMetadata["stage"], busy: boolean): number {
  const base = stage === "validate" ? VALIDATE_STALE_MS : IMPLEMENT_STALE_MS
  return busy ? base * BUSY_GRACE_MULTIPLIER : base
}

function buildRetryPrompt(metadata: RuntimeTaskMetadata, nextAttempt: number, reason: string): string {
  return [
    metadata.originalPrompt.trim(),
    `Attempt: ${nextAttempt}`,
    `Retry of: ${metadata.attempt}`,
    `Stage: ${metadata.stage}`,
    `Target Repo Root: ${metadata.targetRepoRoot}`,
    `Plan: ${metadata.planPath}`,
    `Spec: ${metadata.specPath}`,
    `Context: ${metadata.contextPath}`,
    `Task Contract Path: ${metadata.taskContractPath}`,
    `Retry reason: ${reason}`,
    `Read the existing execution state, validator output, retry state, and task contract before acting. Reuse partial artifacts and continue from the current task state instead of starting over.`,
  ].join("\n")
}

async function readSessionStatuses(client: any, directory: string): Promise<SessionStatusMap> {
  try {
    const result = await client.session.status({ directory })
    if (result?.data) return result.data as SessionStatusMap
    return result as SessionStatusMap
  } catch {
    return {}
  }
}

async function bestEffortAbortSession(client: any, directory: string, sessionID?: string): Promise<boolean> {
  if (!sessionID) return false

  try {
    await client.session.abort({ sessionID, directory })
    return true
  } catch {
    try {
      await client.session.delete({ sessionID, directory })
      return true
    } catch {
      return false
    }
  }
}

async function relaunchAttempt(client: any, metadata: RuntimeTaskMetadata, nextAttempt: number, reason: string): Promise<string | null> {
  try {
    const created = await client.session.create({
      directory: metadata.targetRepoRoot,
      parentID: metadata.parentSessionID,
      title: `Execute task ${metadata.taskID} (retry ${nextAttempt})`,
    })
    const newSessionID = created?.data?.id ?? created?.id
    if (!newSessionID) return null

    await client.session.promptAsync({
      sessionID: newSessionID,
      directory: metadata.targetRepoRoot,
      agent: metadata.stage === "validate" ? "j.validator" : "j.implementer",
      parts: [{ type: "text", text: buildRetryPrompt(metadata, nextAttempt, reason) }],
    })

    return newSessionID
  } catch {
    return null
  }
}

async function maybeRetryTrackedSession(
  client: any,
  directory: string,
  tracked: TrackedSession,
  statusMap: SessionStatusMap,
  trackedBySession: Map<string, TrackedSession>,
  refreshExecutionHeartbeat: boolean
): Promise<void> {
  const { metadata } = tracked
  const statePath = absoluteFromWorkspace(directory, metadata.statePath)
  const runtimePath = absoluteFromWorkspace(directory, metadata.runtimePath)
  const retryPath = absoluteFromWorkspace(directory, metadata.retryStatePath)

  const taskState = readExecutionState(statePath)
  const runtimeState = readRuntimeStatus(runtimePath)
  const effectiveStatus = taskState.status ?? runtimeState.status
  if (isTerminalStatus(effectiveStatus)) {
    trackedBySession.delete(metadata.ownerSessionID ?? "")
    return
  }

  const effectiveAttempt = taskState.attempt ?? runtimeState.attempt ?? metadata.attempt
  if (effectiveAttempt > metadata.attempt) {
    trackedBySession.delete(metadata.ownerSessionID ?? "")
    return
  }

  const retryState = readRetryState(retryPath, metadata.taskID, metadata.attempt)
  if (retryState.automaticRetriesUsed >= MAX_AUTOMATIC_RETRIES) return

  const sessionID = metadata.ownerSessionID
  const statusType = sessionID ? statusMap[sessionID]?.type : undefined
  if (statusType !== "idle") return

  const heartbeatSource = refreshExecutionHeartbeat
    ? taskState.lastHeartbeat ?? runtimeState.lastHeartbeat
    : runtimeState.lastHeartbeat
  const heartbeatMs = heartbeatSource ? Date.parse(heartbeatSource) : tracked.lastEventAtMs || tracked.startedAtMs
  const ageMs = Date.now() - heartbeatMs
  const thresholdMs = effectiveStatus === undefined
    ? TASK_START_TIMEOUT_MS
    : parseStaleThresholdMs(metadata.stage, statusType === "busy")

  if (Number.isNaN(ageMs) || ageMs < thresholdMs) return

  const aborted = await bestEffortAbortSession(client, metadata.targetRepoRoot, sessionID)
  if (!aborted) return

  const nextAttempt = metadata.attempt + 1
  const retryReason = metadata.stage === "validate" ? "stale-validator-session" : "stale-task-session"

  const retriedMetadata: RuntimeTaskMetadata = {
    ...metadata,
    attempt: nextAttempt,
  }
  const newSessionID = await relaunchAttempt(client, retriedMetadata, nextAttempt, retryReason)
  if (!newSessionID) return

  maybeMarkSupersededExecutionState(statePath, metadata.attempt, refreshExecutionHeartbeat)
  if (sessionID) {
    writeRuntimeStatus(sessionRuntimePath(directory, metadata, sessionID), {
      status: "SUPERSEDED",
      lastHeartbeat: isoNow(),
      sessionId: sessionID,
      ownerSessionID: sessionID,
    })
  }
  writeRetryState(retryPath, {
    ...retryState,
    attempt: nextAttempt,
    automaticRetriesUsed: retryState.automaticRetriesUsed + 1,
    lastReason: retryReason,
    abortedSessionId: sessionID,
    retriedFromAttempt: metadata.attempt,
  })

  const nextMetadata: RuntimeTaskMetadata = {
    ...retriedMetadata,
    ownerSessionID: newSessionID,
    ownerSessionTitle: `Execute task ${metadata.taskID} (retry ${nextAttempt})`,
  }

  trackedBySession.delete(sessionID ?? "")
  trackedBySession.set(newSessionID, {
    metadata: nextMetadata,
    startedAtMs: Date.now(),
    lastEventAtMs: Date.now(),
  })

  writeTaskContract(directory, nextMetadata)
  writeMetadata(runtimePath, nextMetadata)
  writeMetadata(sessionRuntimePath(directory, nextMetadata, newSessionID), nextMetadata)
}

export default (async ({ directory, client }: { directory: string; client?: any }) => {
  const config = loadJuninhoConfig(directory)
  const watchdogEnabled = config.workflow?.implement?.watchdogSessionStale !== false
  const refreshExecutionHeartbeat = config.workflow?.implement?.refreshExecutionHeartbeat === true
  const pendingByParent = new Map<string, RuntimeTaskMetadata[]>()
  const trackedBySession = new Map<string, TrackedSession>()

  async function runWatchdogSweep(): Promise<void> {
    if (!watchdogEnabled || !client?.session?.status || !client?.session?.create || !client?.session?.promptAsync) return
    if (trackedBySession.size === 0) return

    const statusMap = await readSessionStatuses(client, directory)
    for (const tracked of Array.from(trackedBySession.values())) {
      await maybeRetryTrackedSession(client, directory, tracked, statusMap, trackedBySession, refreshExecutionHeartbeat)
    }
  }

  if (watchdogEnabled && client?.session?.status && client?.session?.create && client?.session?.promptAsync) {
    const interval = setInterval(() => {
      void runWatchdogSweep()
    }, WATCHDOG_POLL_MS)
    interval.unref?.()
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return

      const prompt = typeof output.args?.prompt === "string" ? output.args.prompt : ""
      const metadata = buildMetadata(directory, input.sessionID, prompt, output.args)
      if (!metadata) return

      writeTaskContract(directory, metadata)
      const retryPath = absoluteFromWorkspace(directory, metadata.retryStatePath)
      if (!existsSync(retryPath)) {
        writeRetryState(retryPath, readRetryState(retryPath, metadata.taskID, metadata.attempt))
      }

      const queue = pendingByParent.get(input.sessionID) ?? []
      queue.push(metadata)
      pendingByParent.set(input.sessionID, queue)
    },

    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      if (event.type === "session.created") {
        const sessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
        const info = typeof event.properties?.info === "object" && event.properties.info
          ? (event.properties.info as Record<string, unknown>)
          : undefined
        const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
        const title = typeof info?.title === "string" ? info.title : ""
        if (!sessionID || !parentID) return

        const queue = pendingByParent.get(parentID)
        if (!queue || queue.length === 0) return

        const titleTaskID = extractTaskID(title)
        const index = titleTaskID ? queue.findIndex((item) => item.taskID === titleTaskID) : 0
        const resolvedIndex = index >= 0 ? index : 0
        const [metadata] = queue.splice(resolvedIndex, 1)
        if (!metadata) return

        if (queue.length > 0) pendingByParent.set(parentID, queue)
        else pendingByParent.delete(parentID)

        const resolvedMetadata: RuntimeTaskMetadata = {
          ...metadata,
          ownerSessionID: sessionID,
          ownerSessionTitle: title || undefined,
        }

        writeMetadata(absoluteFromWorkspace(directory, resolvedMetadata.runtimePath), resolvedMetadata)
        writeMetadata(sessionRuntimePath(directory, resolvedMetadata, sessionID), resolvedMetadata)
        writeTaskContract(directory, resolvedMetadata)
        trackedBySession.set(sessionID, {
          metadata: resolvedMetadata,
          startedAtMs: Date.now(),
          lastEventAtMs: Date.now(),
        })
        return
      }

      if (event.type === "session.deleted") {
        const sessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
        if (sessionID) trackedBySession.delete(sessionID)
        return
      }

      if (event.type !== "session.status" && event.type !== "session.idle") return

      const sessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
      if (!sessionID) return
      const tracked = trackedBySession.get(sessionID)
      if (!tracked) return

      await runWatchdogSweep()
    },
  }
}) satisfies Plugin
