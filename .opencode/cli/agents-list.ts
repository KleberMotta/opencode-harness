import { readdirSync, readFileSync } from "fs"
import path from "path"
import { ok } from "./_lib"

const agentsDir = path.resolve(import.meta.dir, "..", "agents")
const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()

for (const file of files) {
  const text = readFileSync(path.join(agentsDir, file), "utf-8")
  const descMatch = text.match(/^description:\s*(.+)$/m)
  const name = file.replace(/\.md$/, "")
  ok(name)
  if (descMatch) ok(`  ${descMatch[1].trim()}`)
}
