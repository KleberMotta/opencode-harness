import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { featureStateManifestPath, featureStateTaskPaths } from "./j.feature-state-paths"
import { resolveStateFile } from "./j.state-paths"

type TaskBoardRow = {
  id: string
  name: string
  wave: string
  depends: string
  status: string
  attempt: string
  heartbeat: string
  retryCount: string
  validatedCommit: string
  featureCommit: string
  integrationStatus: string
}

function getActiveFeatureSlug(directory: string): string | null {
  const statePath = resolveStateFile(directory, "execution-state.md")
  if (!existsSync(statePath)) return null

  const content = readFileSync(statePath, "utf-8")
  return content.match(/\*\*Feature slug\*\*:\s*(?:\`)?([^\`\s]+)/)?.[1] ?? null
}

function markdownField(body: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return body.match(new RegExp("^-\\s+\\*\\*" + escapedName + "\\*\\*:\\s*([^\\n]+)", "im"))?.[1]?.replace(/`/g, "").trim() ?? ""
}

function parsePlan(planPath: string): Array<{ id: string; name: string; wave: string; depends: string }> {
  if (!existsSync(planPath)) return []
  const content = readFileSync(planPath, "utf-8")
  const markdownTasks = Array.from(content.matchAll(/^##\s+Task\s+([A-Za-z0-9_-]+)\b(?:\s+[—:-]\s*([^\n]+))?[^\n]*$/gm))
  return markdownTasks.map((match) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const nextHeading = markdownTasks.find((candidate) => (candidate.index ?? 0) > (match.index ?? 0))
    const body = content.slice(bodyStart, nextHeading?.index ?? content.length)
    return {
      id: match[1],
      wave: markdownField(body, "Wave") || "-",
      depends: markdownField(body, "Depends") || "-",
      name: match[2]?.trim() || markdownField(body, "Name") || "Task " + match[1],
    }
  })
}

function readStateValue(content: string, label: string): string {
  return content.match(new RegExp("- \\*\\*" + label + "\\*\\*:\\s*([^\\n]+)"))?.[1]?.trim() ?? "-"
}

function readRetryCount(retryPath: string): string {
  if (!existsSync(retryPath)) return "0"
  try {
    const parsed = JSON.parse(readFileSync(retryPath, "utf-8")) as { autoRetryCount?: number }
    return typeof parsed.autoRetryCount === "number" ? String(parsed.autoRetryCount) : "0"
  } catch {
    return "0"
  }
}

function buildBoard(directory: string): string | null {
  const slug = getActiveFeatureSlug(directory)
  if (!slug) return null

  const featureDir = path.join(directory, "docs", "specs", slug)
  const planPath = path.join(featureDir, "plan.md")
  const integrationPath = featureStateManifestPath(directory, slug)
  if (!existsSync(planPath)) return null

  const planTasks = parsePlan(planPath)
  if (planTasks.length === 0) return null

  let integrationManifest: { tasks?: Record<string, any> } | null = null
  if (existsSync(integrationPath)) {
    try {
      integrationManifest = JSON.parse(readFileSync(integrationPath, "utf-8")) as { tasks?: Record<string, any> }
    } catch {
      integrationManifest = null
    }
  }

  const rows: TaskBoardRow[] = planTasks.map((task) => {
    const taskPaths = featureStateTaskPaths(directory, slug, task.id)
    const content = existsSync(taskPaths.statePath) ? readFileSync(taskPaths.statePath, "utf-8") : ""
    const integrationEntry = integrationManifest?.tasks?.[task.id]

    return {
      id: task.id,
      name: task.name,
      wave: task.wave,
      depends: task.depends,
      status: content ? readStateValue(content, "Status") : "PENDING",
      attempt: content ? readStateValue(content, "Attempt") : "-",
      heartbeat: content ? readStateValue(content, "Last heartbeat") : "-",
      retryCount: readRetryCount(taskPaths.retryStatePath),
      validatedCommit: integrationEntry?.validatedCommit ?? "-",
      featureCommit: integrationEntry?.integration?.integratedCommit ?? "-",
      integrationStatus: integrationEntry?.integration?.method
        ? String(integrationEntry.integration.status ?? "pending") + "/" + String(integrationEntry.integration.method)
        : integrationEntry?.integration?.status ?? "pending",
    }
  })

  return [
    "[task-board] Feature: " + slug,
    "",
    "| ID | Wave | Depends | Status | Attempt | Retries | Validated Commit | Feature Commit | Integration | Heartbeat | Task |",
    "|----|------|---------|--------|---------|---------|------------------|----------------|-------------|-----------|------|",
    ...rows.map((row) =>
      "| " + row.id + " | " + row.wave + " | " + row.depends + " | " + row.status + " | " + row.attempt + " | " + row.retryCount + " | " + row.validatedCommit + " | " + row.featureCommit + " | " + row.integrationStatus + " | " + row.heartbeat + " | " + row.name + " |"
    ),
  ].join("\n")
}

export default (async ({ directory }: { directory: string }) => {
  const lastBoardBySession = new Map<string, string>()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const board = buildBoard(directory)
      if (!board) return
      if (lastBoardBySession.get(input.sessionID) === board) return

      lastBoardBySession.set(input.sessionID, board)
      output.output += "\n\n" + board
    },
    "experimental.session.compacting": async (
      _input: { sessionID?: string },
      output: { context: string[] }
    ) => {
      const board = buildBoard(directory)
      if (!board) return

      output.context.push(board)
    },
  }
}) satisfies Plugin
