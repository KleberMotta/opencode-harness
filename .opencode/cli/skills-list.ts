import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import path from "path"
import { ok } from "./_lib"

const skillsDir = path.resolve(import.meta.dir, "..", "skills")
const entries = readdirSync(skillsDir).sort()

for (const name of entries) {
  const dir = path.join(skillsDir, name)
  if (!statSync(dir).isDirectory()) continue
  const skillFile = path.join(dir, "SKILL.md")
  let summary = ""
  if (existsSync(skillFile)) {
    const text = readFileSync(skillFile, "utf-8")
    const descMatch = text.match(/^description:\s*(.+)$/m)
    summary = descMatch ? descMatch[1].trim() : (text.split("\n").find((l) => l.trim().startsWith("#"))?.replace(/^#+\s*/, "") ?? "")
  }
  ok(`${name}`)
  if (summary) ok(`  ${summary}`)
}
