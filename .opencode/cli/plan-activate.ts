import { existsSync, statSync } from "fs"
import path from "path"
import { ACTIVE_PLAN_PATH, writeJson, die, ok } from "./_lib"

const projectArg = process.argv[2]
const slug = process.argv[3]

if (!projectArg || !slug) {
  die("uso: bun plan:activate <project> <slug>\nexemplo: bun plan:activate olxbr/trp-seller-api seller-creation-service")
}

const repoRoot = path.resolve(process.env.HOME ?? "", "repos", projectArg)
if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
  die(`repositório não encontrado: ${repoRoot}`)
}

const planPath = `docs/specs/${slug}/plan.md`
const specPath = `docs/specs/${slug}/spec.md`
const contextPath = `docs/specs/${slug}/CONTEXT.md`

const required = [planPath, specPath, contextPath]
for (const rel of required) {
  const abs = path.join(repoRoot, rel)
  if (!existsSync(abs)) die(`arquivo obrigatório ausente: ${abs}`)
}

const plan = {
  slug,
  writeTargets: [
    {
      project: projectArg,
      targetRepoRoot: repoRoot,
      planPath,
      specPath,
      contextPath,
    },
  ],
  referenceProjects: [],
}

writeJson(ACTIVE_PLAN_PATH, plan)
ok(`plano ativo: ${slug}`)
ok(`  writeTarget: ${projectArg} (${repoRoot})`)
ok("")
ok("para múltiplos write targets ou referenceProjects, edite manualmente:")
ok(`  ${ACTIVE_PLAN_PATH}`)
