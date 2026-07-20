import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import { buildCanonAuditCoverage, canonAuditVerdict } from "../lib/j.canon-audit"

const args = process.argv.slice(2)

function option(name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const workspaceRoot = path.resolve(import.meta.dir, "..", "..")
const commit = option("--commit")
const output = option("--output")
const planPath = option("--plan")
const taskId = option("--task")
const separator = args.indexOf("--files")
const files = separator >= 0 ? args.slice(separator + 1).map((file) => path.resolve(file)) : []

if (!commit || !output || files.length === 0) {
  console.error("usage: bun .opencode/cli/canon-audit.ts --commit <sha> --output <coverage.json> [--plan <plan.md> --task <id>] --files <absolute files...>")
  process.exit(1)
}

const coverage = buildCanonAuditCoverage(workspaceRoot, commit, files, { planPath, taskId })
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(coverage, null, 2) + "\n", "utf-8")
console.log(JSON.stringify(canonAuditVerdict(coverage)))
