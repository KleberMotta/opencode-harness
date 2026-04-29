import { existsSync } from "fs"
import { ACTIVE_PLAN_PATH, readJson, ok } from "./_lib"

if (!existsSync(ACTIVE_PLAN_PATH)) {
  ok("nenhum plano ativo")
  process.exit(0)
}

const plan = readJson<any>(ACTIVE_PLAN_PATH)
ok(`slug: ${plan.slug}`)
ok(`writeTargets:`)
for (const t of plan.writeTargets ?? []) {
  ok(`  - ${t.project}`)
  ok(`      repo:    ${t.targetRepoRoot}`)
  ok(`      plan:    ${t.planPath}`)
  ok(`      spec:    ${t.specPath}`)
  ok(`      context: ${t.contextPath}`)
}
if (plan.referenceProjects?.length) {
  ok(`referenceProjects:`)
  for (const r of plan.referenceProjects) {
    ok(`  - ${r.project}`)
    ok(`      reason: ${r.reason}`)
  }
}
