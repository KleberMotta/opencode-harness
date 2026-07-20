import { execFileSync } from "child_process"
import { existsSync, readFileSync, realpathSync } from "fs"
import path from "path"

// Post-commit task scope: "which files did this commit touch, and are they all
// inside the task's `### Files` contract from plan.md". Migrated verbatim from the
// removed in-process audit plugin so the loop driver (and any post-commit
// reviewer) can reuse the exact same scope semantics without the audit machinery.

/** The minimal shape changedFilesWithinTask needs from a task descriptor. */
export type TaskScopeSeed = {
  targetRepoRoot: string
  taskFiles: string[]
}

function absolute(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value)
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

function normalizeTaskFiles(repo: string, value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : []
  return Array.from(
    new Set(
      raw
        .map((file) => file.trim().replace(/^`|`$/g, ""))
        .filter((file) => file && file.toLowerCase() !== "none")
        .map((file) => absolute(repo, file))
    )
  )
}

function gitValue(repo: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function candidateFiles(repo: string, commit: string): string[] {
  const output = gitValue(repo, ["show", "--format=", "--name-only", commit])
  if (!output) return []
  return output
    .split("\n")
    .filter(Boolean)
    .map((relative) => path.resolve(repo, relative))
}

export function taskFilesFromPlan(repo: string, planPath: string, taskID: string): string[] {
  if (!existsSync(planPath)) return []
  const lines = readFileSync(planPath, "utf-8").split(/\r?\n/)
  const escapedTaskID = taskID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = lines.findIndex((line) => new RegExp(`^##\\s+Task\\s+${escapedTaskID}\\b`).test(line))
  if (start === -1) return []
  const taskEnd = lines.findIndex((line, index) => index > start && /^##\s+Task\s+\d+\b/.test(line))
  const taskLines = lines.slice(start + 1, taskEnd === -1 ? undefined : taskEnd)
  const filesStart = taskLines.findIndex((line) => line.trim() === "### Files")
  if (filesStart === -1) return []
  const filesEnd = taskLines.findIndex((line, index) => index > filesStart && /^###\s+/.test(line))
  const files = taskLines
    .slice(filesStart + 1, filesEnd === -1 ? undefined : filesEnd)
    .map((line) => line.match(/`([^`]+)`/)?.[1] ?? line.replace(/^\s*-\s+/, "").trim())
  return normalizeTaskFiles(repo, files)
}

export function changedFilesWithinTask(seed: TaskScopeSeed, commit: string): { files: string[]; outside: string[] } {
  const files = candidateFiles(seed.targetRepoRoot, commit)
  const allowed = new Set(seed.taskFiles.map((file) => canonicalPath(file)))
  return {
    files,
    outside: files.filter((file) => !allowed.has(canonicalPath(file))),
  }
}

export function taskDependencies(planPath: string, taskID: string): string[] {
  if (!existsSync(planPath)) return []
  const lines = readFileSync(planPath, "utf-8").split(/\r?\n/)
  const escaped = taskID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = lines.findIndex((line) => new RegExp(`^##\\s+Task\\s+${escaped}\\b`).test(line))
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && /^##\s+Task\s+[A-Za-z0-9_-]+\b/.test(line))
  const dependencyLine = lines.slice(start + 1, end === -1 ? undefined : end)
    .find((line) => /^-\s+\*\*Depends\*\*:\s*/.test(line.trim()))
  if (!dependencyLine) return []
  const raw = dependencyLine.replace(/^-\s+\*\*Depends\*\*:\s*/, "").trim()
  if (!raw || /^none$/i.test(raw)) return []
  return raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)
}
