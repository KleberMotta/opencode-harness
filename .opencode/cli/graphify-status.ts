import { existsSync, readdirSync, statSync } from "fs"
import path from "path"
import { readConfig, ok } from "./_lib"
import { getGraphifyPath } from "../lib/j.workspace-paths"

type Status = {
  enabled: boolean
  target: string
  outputPath: string
  graphJsonExists: boolean
  graphReportExists: boolean
  ageDays: number | null
  cacheMb: number
  maxCacheMb: number
  warning: string | null
}

function parseArgs(): { json: boolean; repo: string } {
  let json = false
  let repo = process.env.TARGET_REPO_ROOT || process.cwd()
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--json") json = true
    else if (arg === "--repo" && args[i + 1]) {
      repo = args[i + 1]
      i += 1
    }
  }
  return { json, repo: path.resolve(repo) }
}

function directorySizeBytes(directory: string): number {
  if (!existsSync(directory)) return 0
  let total = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) total += directorySizeBytes(entryPath)
    else if (entry.isFile()) total += statSync(entryPath).size
  }
  return total
}

function fileAgeDays(filePath: string): number | null {
  if (!existsSync(filePath)) return null
  const ageMs = Date.now() - statSync(filePath).mtimeMs
  return Math.max(0, Math.round((ageMs / 86_400_000) * 10) / 10)
}

const { json, repo } = parseArgs()
const config = readConfig()
const graphify = config.workflow?.graphify ?? {}
const outputPath = getGraphifyPath(repo, graphify.outputDir)
const graphJson = path.join(outputPath, "graph.json")
const graphReport = path.join(outputPath, "GRAPH_REPORT.md")
const maxCacheMb = graphify.maxCacheMb ?? 100
const cacheMb = Math.round((directorySizeBytes(path.join(outputPath, "cache")) / 1024 / 1024) * 10) / 10
const warning = cacheMb > maxCacheMb ? `cache Graphify acima de ${maxCacheMb}MB; considere Git LFS` : null

const status: Status = {
  enabled: Boolean(graphify.enabled),
  target: repo,
  outputPath,
  graphJsonExists: existsSync(graphJson),
  graphReportExists: existsSync(graphReport),
  ageDays: fileAgeDays(existsSync(graphReport) ? graphReport : graphJson),
  cacheMb,
  maxCacheMb,
  warning,
}

if (json) {
  ok(JSON.stringify(status, null, 2))
} else {
  ok(`Graphify: ${status.enabled ? "enabled" : "disabled"}`)
  ok(`Target: ${status.target}`)
  ok(`Output: ${status.outputPath}`)
  ok(`graph.json: ${status.graphJsonExists ? "exists" : "missing"}`)
  ok(`GRAPH_REPORT.md: ${status.graphReportExists ? "exists" : "missing"}`)
  ok(`Age days: ${status.ageDays ?? "n/a"}`)
  ok(`Cache MB: ${status.cacheMb}`)
  if (status.warning) ok(`Warning: ${status.warning}`)
}
