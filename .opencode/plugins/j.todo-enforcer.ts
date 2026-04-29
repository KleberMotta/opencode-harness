import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { featureStateTaskDir } from "./j.feature-state-paths"
import { resolveStateFile } from "./j.state-paths"

// Re-injects incomplete tasks to prevent the agent from forgetting pending work.
// Three sources of truth (checked in order):
//   1. .opencode/state/execution-state.md — global session summary
//   2. docs/specs/{slug}/state/tasks/task-*/execution-state.md — per-task state files
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

function parseTaskState(filePath: string): string | null {
  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, "utf-8")
  const statusMatch = content.match(/- **Status**:s*([^
]+)/)
  const waveMatch = content.match(/- **Wave**:s*([^
]+)/)
  const attemptMatch = content.match(/- **Attempt**:s*([^
]+)/)
  const heartbeatMatch = content.match(/- **Last heartbeat**:s*([^
]+)/)
  const failureMatch = content.match(/## Failure Details (if FAILED/BLOCKED)
([sS]*)$/)
  const fileNameMatch = filePath.match(/tasks/task-(d+)/execution-state.md$/)

  const taskID = fileNameMatch?.[1] ?? "?"
  const status = statusMatch?.[1]?.trim()
  if (!status || status === "COMPLETE") return null

  const wave = waveMatch?.[1]?.trim() ?? "?"
  const attempt = attemptMatch?.[1]?.trim() ?? "1"
  const heartbeat = heartbeatMatch?.[1]?.trim()
  const failure = failureMatch?.[1]?.trim()

  let summary = "- [ ] Task " + taskID + " (wave " + wave + ", attempt " + attempt + ") — " + status
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
  const planMatch = content.match(/**Plan**:s*(?:`)?(?:docs/specs/([^/`s]+)/plan.md)/)
  if (planMatch) return planMatch[1]

  const slugMatch = content.match(/**Feature slug**:s*(?:`)?([^`s]+)/)
  if (slugMatch) return slugMatch[1]

  return null
}

function getPerTaskIncomplete(directory: string, slug: string): string[] {
  const tasksDir = path.join(directory, "docs", "specs", slug, "state", "tasks")
  if (!existsSync(tasksDir)) return []

  const tasks: string[] = []
  try {
    const taskDirs = readdirSync(tasksDir).filter((f) => f.startsWith("task-"))
    for (const taskDirName of taskDirs) {
      const taskDir = featureStateTaskDir(directory, slug, taskDirName.replace(/^task-/, ""))
      const summary = parseTaskState(path.join(taskDir, "execution-state.md"))
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

  const slug = getActiveFeatureSlug(directory)
  const perTaskTasks = slug ? getPerTaskIncomplete(directory, slug) : []

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
