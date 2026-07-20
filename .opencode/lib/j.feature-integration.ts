import { execFileSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "fs"
import path from "path"
import { featureStateManifestPath, featureStateTaskPaths } from "./j.feature-state-paths"
import { taskDependencies } from "./j.task-scope"
import { loadActivePlanTargets } from "./j.workspace-paths"

// Lean feature-integration bookkeeping migrated out of the removed in-process
// audit plugin. The manifest lock and the plugin-owned completion
// record survive, but the audit-era attestation is stripped: no receipt,
// git-anchored dependency re-validation, harness-dirty gate, or worktree
// dirty-snapshot comparison. What remains is "write tasks[id].validatedCommit
// under a lock after checking branch/HEAD/active-plan and that dependencies are
// genuinely complete". `removeTaskFromManifest` is the driver's undo primitive.

type ManifestHints = Parameters<typeof featureStateManifestPath>[2]

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf-8")
  renameSync(temporary, filePath)
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value)
  if (existsSync(resolved)) return realpathSync(resolved)
  const missing: string[] = []
  let current = resolved
  while (!existsSync(current) && current !== path.dirname(current)) {
    missing.unshift(path.basename(current))
    current = path.dirname(current)
  }
  return path.join(realpathSync(current), ...missing)
}

function gitValue(repo: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function statusFromState(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined
  return readFileSync(filePath, "utf-8").match(/\*\*Status\*\*:\s*([^\n]+)/)?.[1]?.trim()
}

function attemptFromState(filePath: string): number {
  if (!existsSync(filePath)) return 1
  const raw = readFileSync(filePath, "utf-8").match(/\*\*Attempt\*\*:\s*(\d+)/)?.[1]
  return raw ? Number.parseInt(raw, 10) : 1
}

function labelFromPlan(planPath: string, taskID: string): string {
  if (!existsSync(planPath)) return `Task ${taskID}`
  const match = readFileSync(planPath, "utf-8").match(
    new RegExp(`^##\\s+Task\\s+${taskID}\\s+[—-]\\s+(.+)$`, "m")
  )
  return match?.[1]?.trim() || `Task ${taskID}`
}

function taskAgent(planPath: string, taskID: string): string {
  if (!existsSync(planPath)) return ""
  const lines = readFileSync(planPath, "utf-8").split(/\r?\n/)
  const escaped = taskID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = lines.findIndex((line) => new RegExp(`^##\\s+Task\\s+${escaped}\\b`).test(line))
  if (start === -1) return ""
  const end = lines.findIndex((line, index) => index > start && /^##\s+Task\s+[A-Za-z0-9_-]+\b/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end)
    .find((line) => /^-\s+\*\*Agent\*\*:\s*/.test(line.trim()))
    ?.replace(/^-\s+\*\*Agent\*\*:\s*/, "")
    .replace(/`/g, "")
    .trim() ?? ""
}

// Acquire the manifest lock as a single file created with O_EXCL ('wx'), whose
// body carries the owner pid+timestamp. Acquisition is race-free: only one
// writer wins the exclusive create. Reclaiming a stale lock (owner crashed
// mid-section, >60s old) is best-effort — unlink then one exclusive retry, so if
// a second reclaimer already won, this retry hits EEXIST and fails closed rather
// than double-entering the critical section. `statSync`/`rmSync` also tolerate a
// legacy directory lock left by a prior crash. A fully atomic steal would need a
// rename dance, which is beyond this low-severity recovery path.
export function acquireManifestLock(lockPath: string) {
  const payload = `${process.pid}:${new Date().toISOString()}\n`
  try {
    writeFileSync(lockPath, payload, { flag: "wx" })
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  let mtimeMs: number
  try {
    mtimeMs = statSync(lockPath).mtimeMs
  } catch {
    // Vanished between the failed create and the stat: try once more to acquire.
    writeFileSync(lockPath, payload, { flag: "wx" })
    return
  }
  if (Date.now() - mtimeMs <= 60_000) {
    throw new Error("Integration manifest is locked by a concurrent writer")
  }
  rmSync(lockPath, { recursive: true, force: true })
  writeFileSync(lockPath, payload, { flag: "wx" })
}

// A dependency is genuinely complete when its execution-state.md is COMPLETE and
// (for product tasks) it is integrated in the manifest. j.validator/j.test-writer
// tasks never carry a manifest integration entry, so they gate on COMPLETE only.
function ensureDependenciesComplete(
  directory: string,
  featureSlug: string,
  targetRepoRoot: string,
  planPath: string,
  taskID: string,
  manifest: any,
) {
  for (const dependency of taskDependencies(planPath, taskID)) {
    const dependencyPaths = featureStateTaskPaths(directory, featureSlug, dependency, { targetRepoRoot })
    if (statusFromState(dependencyPaths.statePath) !== "COMPLETE") {
      throw new Error(`Dependency task ${dependency} is not COMPLETE`)
    }
    const isValidatorLike = ["j.validator", "j.test-writer"].includes(taskAgent(planPath, dependency))
    if (!isValidatorLike) {
      if (!manifest.tasks?.[dependency]) throw new Error(`Dependency task ${dependency} is missing from integration manifest`)
      const integration = manifest.tasks?.[dependency]?.integration
      if (!integration?.status || integration.status === "pending") {
        throw new Error(`Dependency task ${dependency} has pending integration`)
      }
    }
  }
}

/**
 * Record a completed task's validated commit into the feature integration
 * manifest under a lock. Verifies the target repo is on the feature branch with
 * HEAD at `commit`, the active plan still points at the target, and every
 * dependency is genuinely complete before writing.
 */
export function recordPluginOwnedCompletion(options: {
  directory: string
  targetRepoRoot: string
  featureSlug: string
  taskID: string
  planPath: string
  taskStatePath: string
  manifestPath: string
  commit: string
}) {
  const { directory, targetRepoRoot, featureSlug, taskID, planPath, taskStatePath, manifestPath, commit } = options
  const lockPath = `${manifestPath}.lock`
  acquireManifestLock(lockPath)
  try {
    const manifest = readJson<any>(manifestPath)
    if (!manifest) throw new Error(`Missing integration manifest ${manifestPath}`)
    if (manifest.featureSlug !== featureSlug) throw new Error("Integration manifest feature mismatch")
    const branch = gitValue(targetRepoRoot, ["branch", "--show-current"])
    if (!branch || branch !== manifest.featureBranch) throw new Error(`Expected branch ${manifest.featureBranch}, got ${branch ?? "detached"}`)
    const head = gitValue(targetRepoRoot, ["rev-parse", "HEAD"])
    if (head !== commit) throw new Error(`Expected HEAD ${commit}, got ${head ?? "unknown"}`)
    const activeTarget = loadActivePlanTargets(directory).find((target) =>
      target.targetRepoRoot && canonicalPath(target.targetRepoRoot) === canonicalPath(targetRepoRoot) && target.slug === featureSlug
    )
    if (!activeTarget) throw new Error("Active plan no longer points to the completed target")
    ensureDependenciesComplete(directory, featureSlug, targetRepoRoot, planPath, taskID, manifest)
    const now = new Date().toISOString()
    const existing = manifest.tasks?.[taskID] ?? {}
    manifest.tasks = manifest.tasks ?? {}
    manifest.tasks[taskID] = {
      ...existing,
      taskID,
      validatedCommit: commit,
      attempt: attemptFromState(taskStatePath),
      taskLabel: labelFromPlan(planPath, taskID),
      recordedAt: now,
      integration: {
        status: "direct",
        method: "direct-commit",
        featureBranch: branch,
        integratedAt: now,
        integratedCommit: commit,
      },
    }
    manifest.lastUpdatedAt = now
    writeJsonAtomic(manifestPath, manifest)
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

/**
 * Undo primitive for the loop driver: drop a task's entry from the integration
 * manifest so a reset-and-redo returns the task to PENDING. No-op when the task
 * or manifest is absent. Runs under the manifest lock.
 */
export function removeTaskFromManifest(workspace: string, slug: string, taskId: string, hints?: ManifestHints) {
  const manifestPath = featureStateManifestPath(workspace, slug, hints)
  const lockPath = `${manifestPath}.lock`
  acquireManifestLock(lockPath)
  try {
    const manifest = readJson<any>(manifestPath)
    if (!manifest || !manifest.tasks || !(taskId in manifest.tasks)) return
    delete manifest.tasks[taskId]
    manifest.lastUpdatedAt = new Date().toISOString()
    writeJsonAtomic(manifestPath, manifest)
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}
