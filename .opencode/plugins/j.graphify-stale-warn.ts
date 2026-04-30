import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readdirSync, statSync } from "fs"
import path from "path"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { getGraphifyPath, loadActivePlanTarget } from "../lib/j.workspace-paths"

const MS_PER_DAY = 24 * 60 * 60 * 1000

function directorySizeBytes(target: string): number {
  if (!existsSync(target)) return 0

  try {
    const stats = statSync(target)
    if (stats.isFile()) return stats.size
    if (!stats.isDirectory()) return 0

    let total = 0
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      total += directorySizeBytes(path.join(target, entry.name))
    }
    return total
  } catch {
    return 0
  }
}

function loadGraphifyWarning(directory: string): string | null {
  const target = loadActivePlanTarget(directory)
  if (!target?.targetRepoRoot) return null

  const config = loadJuninhoConfig(target.targetRepoRoot)
  const graphify = config.workflow?.graphify
  if (!graphify?.enabled) return null

  const outputDir = getGraphifyPath(target.targetRepoRoot, graphify.outputDir)
  const reportPath = path.join(outputDir, "GRAPH_REPORT.md")
  const graphPath = path.join(outputDir, "graph.json")
  const cachePath = path.join(outputDir, "cache")

  const warnings: string[] = []
  if (!existsSync(reportPath)) warnings.push("GRAPH_REPORT.md missing")
  if (!existsSync(graphPath)) warnings.push("graph.json missing")

  const availableArtifacts = [reportPath, graphPath].filter((artifact) => existsSync(artifact))
  if (availableArtifacts.length > 0) {
    try {
      const freshestMtimeMs = Math.max(...availableArtifacts.map((artifact) => statSync(artifact).mtimeMs))
      const ageDays = (Date.now() - freshestMtimeMs) / MS_PER_DAY
      const staleAfterDays = graphify.staleAfterDays ?? 7
      if (ageDays > staleAfterDays) {
        warnings.push(`output stale (${ageDays.toFixed(1)}d > ${staleAfterDays}d)`)
      }
    } catch {
      warnings.push("could not read Graphify artifact timestamps")
    }
  }

  const cacheMb = directorySizeBytes(cachePath) / (1024 * 1024)
  const maxCacheMb = graphify.maxCacheMb ?? 100
  if (cacheMb > maxCacheMb) {
    warnings.push(`cache ${cacheMb.toFixed(1)} MB exceeds ${maxCacheMb} MB; consider Git LFS`)
  }

  if (warnings.length === 0) return null
  const relativeOutput = path.relative(target.targetRepoRoot, outputDir) || outputDir
  return `[graphify-stale-warn] ${warnings.join("; ")}. Output: ${relativeOutput}`
}

export default (async ({ directory }: { directory: string }) => {
  const lastWarningBySession = new Map<string, string>()

  return {
    "tool.execute.after": async (
      input: { sessionID: string },
      output: { output: string }
    ) => {
      const warning = loadGraphifyWarning(directory)
      if (!warning) return
      if (lastWarningBySession.get(input.sessionID) === warning) return

      lastWarningBySession.set(input.sessionID, warning)
      output.output += `\n\n${warning}`
    },
    "experimental.session.compacting": async (
      _input: Record<string, unknown>,
      output: { context: string[] }
    ) => {
      const warning = loadGraphifyWarning(directory)
      if (!warning) return

      output.context.push(warning)
    },
  }
}) satisfies Plugin
