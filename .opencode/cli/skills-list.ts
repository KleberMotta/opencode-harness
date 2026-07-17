import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import path from "path"
import { CONTEXT_SPECIAL_DIRS } from "../lib/j.workspace-paths"
import { ok } from "./_lib"

const workspaceRoot = path.resolve(import.meta.dir, "..", "..")

function skillSummary(skillFile: string): string {
  if (!existsSync(skillFile)) return ""
  const text = readFileSync(skillFile, "utf-8")
  const descMatch = text.match(/^description:\s*(.+)$/m)
  return descMatch ? descMatch[1].trim() : (text.split("\n").find((l) => l.trim().startsWith("#"))?.replace(/^#+\s*/, "") ?? "")
}

function listSkills(skillsDir: string, label: string): void {
  if (!existsSync(skillsDir)) return
  const names = readdirSync(skillsDir).sort().filter((name) => {
    try {
      return statSync(path.join(skillsDir, name)).isDirectory()
    } catch {
      return false
    }
  })
  if (names.length === 0) return

  ok(label)
  for (const name of names) {
    const summary = skillSummary(path.join(skillsDir, name, "SKILL.md"))
    ok(`  ${name}`)
    if (summary) ok(`    ${summary}`)
  }
}

listSkills(path.join(workspaceRoot, ".opencode", "skills"), "workspace (.opencode/skills):")

for (const entry of readdirSync(workspaceRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  if (entry.name.startsWith(".") || CONTEXT_SPECIAL_DIRS.has(entry.name)) continue
  listSkills(
    path.join(workspaceRoot, entry.name, "agent-context", "skills"),
    `contexto ${entry.name} (${entry.name}/agent-context/skills):`
  )
}
