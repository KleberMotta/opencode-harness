import { existsSync, rmSync, statSync } from "fs"
import path from "path"
import { ACTIVE_PLAN_PATH, readJson, die, ok } from "./_lib"

const slug = process.argv[2]
const taskId = process.argv[3]

if (!slug || !taskId) {
  die("uso: bun state:clear-task <slug> <task-id>\nexemplo: bun state:clear-task seller-creation-service task-5")
}

if (!existsSync(ACTIVE_PLAN_PATH)) {
  die("nenhum plano ativo")
}

const plan = readJson<any>(ACTIVE_PLAN_PATH)
if (plan.slug !== slug) {
  die(`slug do plano ativo é "${plan.slug}", não "${slug}"`)
}

const targets: any[] = plan.writeTargets ?? []
let removed = 0

for (const t of targets) {
  const taskDir = path.join(t.targetRepoRoot, "docs", "specs", slug, "state", "tasks", taskId)
  if (existsSync(taskDir) && statSync(taskDir).isDirectory()) {
    rmSync(taskDir, { recursive: true, force: true })
    ok(`removido: ${taskDir}`)
    removed++
  }
}

if (removed === 0) ok("nenhum diretório de task encontrado para limpar")
