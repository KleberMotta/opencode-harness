import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { getGraphifyPath, loadActivePlanTarget } from "../lib/j.workspace-paths"

const MAX_SUMMARY_CHARS = 12000

type GraphifySummary = {
  reportPath: string
  summary: string
}

function summarizeGraphReport(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= MAX_SUMMARY_CHARS) return normalized

  const lines = normalized.split("\n")
  const kept: string[] = []
  let used = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (kept.length === 0 || kept[kept.length - 1] === "") continue
    } else if (!/^#{1,6}\s|^-\s|^\*\s|^\d+\.\s/.test(trimmed) && used > MAX_SUMMARY_CHARS * 0.7) {
      continue
    }

    const candidate = line + "\n"
    if (used + candidate.length > MAX_SUMMARY_CHARS - 64) break
    kept.push(line)
    used += candidate.length
  }

  const truncated = (kept.join("\n").trim() || normalized.slice(0, MAX_SUMMARY_CHARS - 64).trim())
  return truncated + "\n\n[graphify-inject] Summary truncated."
}

function loadGraphifySummary(directory: string): GraphifySummary | null {
  const target = loadActivePlanTarget(directory)
  if (!target?.targetRepoRoot) return null

  const config = loadJuninhoConfig(target.targetRepoRoot)
  const graphify = config.workflow?.graphify
  if (!graphify?.enabled) return null

  const outputDir = getGraphifyPath(target.targetRepoRoot, graphify.outputDir)
  const reportPath = path.join(outputDir, "GRAPH_REPORT.md")
  if (!existsSync(reportPath)) return null

  const content = readFileSync(reportPath, "utf-8").trim()
  if (!content) return null

  return {
    reportPath: path.relative(target.targetRepoRoot, reportPath) || reportPath,
    summary: summarizeGraphReport(content),
  }
}

export default (async ({ directory }: { directory: string }) => {
  const injectedBySession = new Set<string>()

  return {
    "tool.execute.after": async (
      input: { sessionID: string },
      output: { output: string }
    ) => {
      if (injectedBySession.has(input.sessionID)) return

      const summary = loadGraphifySummary(directory)
      if (!summary) return

      injectedBySession.add(input.sessionID)
      output.output += `\n\n[graphify-inject] Graphify summary from ${summary.reportPath}:\n\n${summary.summary}`
    },
    "experimental.session.compacting": async (
      _input: Record<string, unknown>,
      output: { context: string[] }
    ) => {
      const summary = loadGraphifySummary(directory)
      if (!summary) return

      output.context.push(`[graphify-inject] Graphify summary from ${summary.reportPath}:\n\n${summary.summary}`)
    },
  }
}) satisfies Plugin
