import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { featureStateDir, featureStateTaskDir } from "../lib/j.feature-state-paths"
import { resolveStateFile } from "../lib/j.state-paths"
import { loadActivePlanTargets } from "../lib/j.workspace-paths"

// Re-injects incomplete tasks to prevent the agent from forgetting pending work.
// Three sources of truth (checked in order):
//   1. .opencode/state/execution-state.md — global session summary
//   2. docs/specs/{slug}/state/tasks/task-*/execution-state.md — per-task state files
//      Resolved per active-plan write target (multi-project safe).
//
// Two hooks:
//   experimental.session.compacting — injects pending tasks into compaction
//     context so they survive context window resets.
//   tool.execute.after on Write/Edit — lean reminder of pending count after
//     file modifications, nudging the agent to continue.

function getIncompleteFromFile(filePath: string): string[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, "utf-8")
  return content
    .split("\n")
    .filter((line) => /^\s*-\s*\[\s*\]/.test(line))
    .map((line) => line.trim())
}

function parseTaskState(filePath: string, projectLabel?: string): string | null {
  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, "utf-8")
  const statusMatch = content.match(/- \*\*Status\*\*:\s*([^\n]+)/)
  const waveMatch = content.match(/- \*\*Wave\*\*:\s*([^\n]+)/)
  const attemptMatch = content.match(/- \*\*Attempt\*\*:\s*([^\n]+)/)
  const heartbeatMatch = content.match(/- \*\*Last heartbeat\*\*:\s*([^\n]+)/)
  const failureMatch = content.match(/## Failure Details \(if FAILED\/BLOCKED\)\n([\s\S]*)$/)
  const fileNameMatch = filePath.match(/tasks\/task-(\d+)\/execution-state\.md$/)

  const taskID = fileNameMatch?.[1] ?? "?"
  const status = statusMatch?.[1]?.trim()
  if (!status || status === "COMPLETE") return null

  const wave = waveMatch?.[1]?.trim() ?? "?"
  const attempt = attemptMatch?.[1]?.trim() ?? "1"
  const heartbeat = heartbeatMatch?.[1]?.trim()
  const failure = failureMatch?.[1]?.trim()

  const projectPrefix = projectLabel ? "[" + projectLabel + "] " : ""
  let summary = "- [ ] " + projectPrefix + "Task " + taskID + " (wave " + wave + ", attempt " + attempt + ") — " + status
  if (heartbeat) summary += " — heartbeat " + heartbeat
  if (status === "FAILED" || status === "BLOCKED") {
    const detail = failure && failure !== "None." ? failure.split("\n")[0].trim() : "see task state"
    summary += " — " + detail
  }

  return summary
}

function getActiveFeatureSlug(directory: string): string | null {
  const statePath = resolveStateFile(directory, "execution-state.md")
  if (!existsSync(statePath)) return null

  const content = readFileSync(statePath, "utf-8")
  const planMatch = content.match(/\*\*Plan\*\*:\s*(?:`)?(?:docs\/specs\/([^/`\s]+)\/plan\.md)/)
  if (planMatch) return planMatch[1]

  const slugMatch = content.match(/\*\*Feature slug\*\*:\s*(?:`)?([^`\s]+)/)
  if (slugMatch) return slugMatch[1]

  return null
}

function slugFromPlanPath(planPath: string | undefined): string | null {
  if (!planPath) return null
  const match = planPath.match(/docs\/specs\/([^/]+)\/plan\.md$/)
  return match?.[1] ?? null
}

function getPerTaskIncompleteForTarget(directory: string, slug: string, projectLabel?: string): string[] {
  // Task state lives in workspace root (directory), not in target repos
  const tasksDir = path.join(featureStateDir(directory, slug), "tasks")
  if (!existsSync(tasksDir)) return []

  const tasks: string[] = []
  try {
    const taskDirs = readdirSync(tasksDir).filter((f) => f.startsWith("task-"))
    for (const taskDirName of taskDirs) {
      const taskID = taskDirName.replace(/^task-/, "")
      const taskDir = featureStateTaskDir(directory, slug, taskID)
      const summary = parseTaskState(path.join(taskDir, "execution-state.md"), projectLabel)
      if (summary) tasks.push(summary)
    }
  } catch {
    // Directory read failed — silently skip
  }
  return tasks
}

function getIncompleteTasks(directory: string): string[] {
  const globalPath = resolveStateFile(directory, "execution-state.md")
  const globalTasks = getIncompleteFromFile(globalPath)

  const perTaskTasks: string[] = []

  // Multi-target: iterate active-plan write targets and read tasks from workspace.
  // Task state is centralized in the workspace, not per-target.
  const activeTargets = loadActivePlanTargets(directory)
  const visitedSlugs = new Set<string>()
  for (const target of activeTargets) {
    const slug = target.slug ?? slugFromPlanPath(target.planPath) ?? undefined
    if (!slug) continue
    if (visitedSlugs.has(slug)) continue
    visitedSlugs.add(slug)
    const projectLabel = target.project ?? (target.targetRepoRoot ? path.basename(target.targetRepoRoot) : undefined)
    perTaskTasks.push(...getPerTaskIncompleteForTarget(directory, slug, projectLabel))
  }

  // Fallback: workspace-local layout when no active plan targets.
  if (activeTargets.length === 0) {
    const slug = getActiveFeatureSlug(directory)
    if (slug) perTaskTasks.push(...getPerTaskIncompleteForTarget(directory, slug))
  }

  const seen = new Set<string>()
  const all: string[] = []
  for (const task of [...globalTasks, ...perTaskTasks]) {
    if (!seen.has(task)) {
      seen.add(task)
      all.push(task)
    }
  }
  return all
}

export default (async ({ directory }: { directory: string }) => ({
  "experimental.session.compacting": async (
    _input: Record<string, unknown>,
    output: { context: string[]; prompt?: string }
  ) => {
    const incomplete = getIncompleteTasks(directory)
    if (incomplete.length === 0) return

    output.context.push(
      `[todo-enforcer] ${incomplete.length} incomplete task(s) remaining:\n\n` +
        incomplete.join("\n") +
        `\n\nDo not stop until all tasks are complete. Continue working.`
    )
  },
  "tool.execute.after": async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any }
  ) => {
    if (!["Write", "Edit", "MultiEdit"].includes(input.tool)) return

    const incomplete = getIncompleteTasks(directory)
    if (incomplete.length === 0) return

    output.output +=
      `\n\n[todo-enforcer] ${incomplete.length} task(s) still pending. Continue working.`
  },
})) satisfies Plugin
