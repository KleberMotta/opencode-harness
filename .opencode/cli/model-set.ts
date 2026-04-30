import { readConfig, writeConfig, die, ok, readJson } from "./_lib"
import { AGENTS_BY_TIER, type Tier } from "./_tier-map"
import { readFileSync, existsSync } from "fs"
import path from "path"

const tier = process.argv[2] as Tier
const model = process.argv[3]

if (!tier || !["strong", "medium", "weak"].includes(tier)) {
  die("uso: bun model:set-<strong|medium|weak> <model-id>")
}
if (!model) {
  die(
    `uso: bun model:set-${tier} <model-id>\nexemplo: bun model:set-${tier} github-copilot/claude-opus-4.7`,
  )
}

// Modelos por tier vivem APENAS em juninho-config.json. O wrapper bin/oc lê
// este arquivo e exporta JUNINHO_{STRONG,MEDIUM,WEAK}_MODEL para o opencode,
// que resolve `{env:JUNINHO_<TIER>_MODEL}` em opencode.json (agent.<name>.model).
//
// Frontmatters dos agentes NÃO declaram `model:` (overrideria o env).
// Não há mais propagação manual.
const config = readConfig() as Record<string, any>
const previous = config[tier]
config[tier] = model
writeConfig(config)

ok(`${tier}: ${previous ?? "(unset)"} → ${model}`)
ok(`agentes (${tier}): ${AGENTS_BY_TIER[tier].join(", ")}`)
ok("propagação automática via bin/oc + {env:JUNINHO_<TIER>_MODEL} em opencode.json")

// Sanity check — alerta se algum frontmatter ainda declara `model:` (overrideria).
const REPO_ROOT = path.resolve(import.meta.dir, "..", "..")
const AGENTS_DIR = path.join(REPO_ROOT, ".opencode", "agents")
const offenders: string[] = []
for (const agentName of AGENTS_BY_TIER[tier]) {
  const file = path.join(AGENTS_DIR, `${agentName}.md`)
  if (!existsSync(file)) continue
  const content = readFileSync(file, "utf-8")
  if (/^model:\s*\S+/m.test(content)) {
    offenders.push(path.relative(REPO_ROOT, file))
  }
}
if (offenders.length > 0) {
  ok("")
  ok(`aviso: ${offenders.length} frontmatter(s) ainda declaram \`model:\` e vão sobrescrever o env:`)
  for (const f of offenders) ok(`  • ${f}`)
  ok("remova a linha `model:` desses arquivos para o tier dinâmico funcionar.")
}

// Aviso para refs literais soltas (README, evals fixtures, opencode.json hardcoded).
const orphanFiles = scanOrphanReferences(previous, model)
if (orphanFiles.length > 0) {
  ok("")
  ok(`aviso: ${orphanFiles.length} arquivo(s) ainda referenciam "${previous}" literalmente:`)
  for (const f of orphanFiles) ok(`  • ${f}`)
  ok("revise manualmente se forem relevantes.")
}

function scanOrphanReferences(prev: string | undefined, next: string): string[] {
  if (!prev || prev === next) return []
  const out: string[] = []
  const candidates = [
    path.join(REPO_ROOT, "README.md"),
    path.join(REPO_ROOT, "opencode.json"),
    path.join(REPO_ROOT, ".opencode", "evals", "lib", "opencode-behavioral-runner.ts"),
    path.join(REPO_ROOT, ".opencode", "evals", "tests", "structural", "harness-structure.test.ts"),
  ]
  for (const f of candidates) {
    if (!existsSync(f)) continue
    const content = readFileSync(f, "utf-8")
    if (content.includes(prev)) out.push(path.relative(REPO_ROOT, f))
  }
  return out
}
