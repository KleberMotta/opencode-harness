import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import path from "path"
import { discoverContextRoots } from "../lib/j.workspace-paths"
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

for (const contextRoot of discoverContextRoots(workspaceRoot)) {
  const label = path.relative(path.join(workspaceRoot, "contexts"), path.dirname(contextRoot))
  listSkills(path.join(contextRoot, "skills"), `contexto ${label} (${path.relative(workspaceRoot, contextRoot)}/skills):`)
}
