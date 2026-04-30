import { spawnSync } from "child_process"
import path from "path"

const scriptPath = path.resolve(import.meta.dir, "..", "scripts", "graphify-build.sh")
const result = spawnSync("sh", [scriptPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
})

if (result.error) {
  console.error(`erro: falha ao executar graphify-build.sh: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
