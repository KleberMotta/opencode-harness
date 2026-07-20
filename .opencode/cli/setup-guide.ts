#!/usr/bin/env bun
// Pós-install doctor: verifica tudo que o harness precisa para funcionar nesta
// máquina e imprime o próximo passo exato para cada item pendente.
// Nunca falha (exit 0) — é um guia, não um gate.

import { execSync } from "child_process"
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "fs"
import os from "os"
import path from "path"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { discoverContextRoots, loadActivePlanTargets } from "../lib/j.workspace-paths"

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "..", "..")

type Check = { ok: boolean; warn?: boolean; label: string; fix?: string }
const checks: Check[] = []

function commandPath(cmd: string): string | null {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf-8", shell: "/bin/sh" }).trim() || null
  } catch {
    return null
  }
}

// 1. Binário do opencode
const opencodeOnPath = commandPath("opencode")
const opencodeHome = path.join(os.homedir(), ".opencode", "bin", "opencode")
if (opencodeOnPath) {
  checks.push({ ok: true, label: `opencode no PATH (${opencodeOnPath})` })
} else if (existsSync(opencodeHome)) {
  checks.push({
    ok: false,
    warn: true,
    label: "opencode instalado mas fora do PATH",
    fix: `adicione ao seu shell profile: export PATH="$HOME/.opencode/bin:$PATH" (necessário também para os evals behavioral)`,
  })
} else {
  checks.push({
    ok: false,
    label: "opencode não encontrado",
    fix: "instale: curl -fsSL https://opencode.ai/install | bash",
  })
}

// 2. Config gerada + modelos
const opencodeJson = path.join(WORKSPACE_ROOT, "opencode.json")
checks.push(
  existsSync(opencodeJson)
    ? { ok: true, label: "opencode.json gerado" }
    : { ok: false, label: "opencode.json ausente", fix: "rode: bun run sync" }
)
const config = loadJuninhoConfig(WORKSPACE_ROOT)
const models = config.models ?? ({} as Record<string, string>)
const tiersOk = Boolean(models.strong && models.medium && models.weak)
checks.push(
  tiersOk
    ? { ok: true, label: `modelos configurados (strong=${models.strong})` }
    : { ok: false, label: "tiers de modelo incompletos em juninho-config.json", fix: "rode: bun run model:list e bun run model:set <tier> <modelo>" }
)

// 3. Auth do provider (best-effort — o arquivo é do opencode)
const authFile = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
let authOk = false
try {
  const providers = Object.keys(JSON.parse(readFileSync(authFile, "utf-8")))
  authOk = providers.length > 0
  checks.push(
    authOk
      ? { ok: true, label: `provider autenticado (${providers.join(", ")})` }
      : { ok: false, label: "nenhum provider autenticado", fix: "rode: opencode auth login (github-copilot)" }
  )
} catch {
  checks.push({ ok: false, warn: true, label: "não foi possível verificar auth do opencode", fix: "confirme com: opencode auth list (ou opencode auth login)" })
}

// 4. Pre-commit hooks nos repos-alvo do plano ativo
const targets = loadActivePlanTargets(WORKSPACE_ROOT)
if (targets.length === 0) {
  checks.push({
    ok: true,
    warn: true,
    label: "nenhum plano ativo — instale o pre-commit hook em cada repo-alvo quando começar",
    fix: "por repo: bun run hooks:install -- --repo <path-do-repo>",
  })
} else {
  for (const target of targets) {
    const repo = target.targetRepoRoot
    if (!repo) continue
    const hook = path.join(repo, ".git", "hooks", "pre-commit")
    let hookOk = false
    try {
      // symlink pendurado conta como ausente (o git ignora em silêncio)
      hookOk = existsSync(hook) && Boolean(lstatSync(hook)) && existsSync(realpathSync(hook))
    } catch {
      hookOk = false
    }
    checks.push(
      hookOk
        ? { ok: true, label: `pre-commit hook ok em ${path.basename(repo)}` }
        : { ok: false, label: `pre-commit hook ausente/quebrado em ${path.basename(repo)}`, fix: `rode: bun run hooks:install -- --repo ${repo}` }
    )
  }
}

// 5. Docker (integration tests de repos Spring dependem de containers locais)
const dockerOk = (() => {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 })
    return true
  } catch {
    return false
  }
})()
checks.push(
  dockerOk
    ? { ok: true, label: "docker rodando" }
    : { ok: false, warn: true, label: "docker indisponível", fix: "suba o Docker; repos Spring precisam de `make dependencies` para integration tests (/j.check tenta subir sozinho)" }
)

// 6. Contextos ({workspace}/contexts/*): one Git repository + skills/ + knowledge/
const contextsRoot = path.join(WORKSPACE_ROOT, "contexts")
checks.push(
  existsSync(path.join(contextsRoot, ".git"))
    ? { ok: true, label: "repositório Git de contexts ok" }
    : { ok: false, warn: true, label: "repositório Git de contexts ausente", fix: `inicialize ou clone em ${contextsRoot}` }
)
const contextDirs = discoverContextRoots(WORKSPACE_ROOT)
for (const contextDir of contextDirs) {
  const contextLabel = path.relative(WORKSPACE_ROOT, contextDir)
  const missing: string[] = []
  if (!existsSync(path.join(contextDir, "AGENTS.md")) && !existsSync(path.join(contextDir, "skill-map.json"))) {
    missing.push("AGENTS.md or skill-map.json")
  }
  checks.push(
    missing.length === 0
      ? { ok: true, label: `contexto ok em ${contextLabel}` }
      : {
          ok: false,
          warn: true,
          label: `contexto incompleto em ${contextLabel}`,
          fix: `falta: ${missing.join(", ")} — crie em ${contextDir}`,
        }
  )

  // lint-rules só entra no gate do lint-structure.sh com jar + config + CLI;
  // faltando qualquer um, o gate pula em silêncio — avise, não bloqueie.
  const lintRulesDir = path.join(contextDir, "lint-rules")
  if (existsSync(lintRulesDir)) {
    const detektMissing: string[] = []
    if (!existsSync(path.join(lintRulesDir, "rules.jar"))) detektMissing.push("rules.jar (cd lint-rules && gradle build && cp build/libs/rules.jar .)")
    if (!existsSync(path.join(lintRulesDir, "detekt.yml"))) detektMissing.push("detekt.yml")
    if (!commandPath("detekt")) detektMissing.push("CLI detekt (brew install detekt)")
    checks.push(
      detektMissing.length === 0
        ? { ok: true, label: `regras detekt ativas em ${contextLabel}` }
        : {
            ok: false,
            warn: true,
            label: `regras detekt de ${contextLabel} inativas (gate pula em silêncio)`,
            fix: `falta: ${detektMissing.join(" · ")}`,
          }
    )
  }
}

// 7. References materializadas (informativo)
const hasReferencesJson = contextDirs.some((dir) => existsSync(path.join(dir, "references.json")))
if (hasReferencesJson) {
  let referencesMaterialized = false
  try {
    const generated = JSON.parse(readFileSync(opencodeJson, "utf-8"))
    referencesMaterialized =
      typeof generated.references === "object" &&
      generated.references !== null &&
      Object.keys(generated.references).length > 0
  } catch {
    referencesMaterialized = false
  }
  checks.push(
    referencesMaterialized
      ? { ok: true, label: "references materializadas no opencode.json" }
      : {
          ok: false,
          warn: true,
          label: "references.json de contexto existe mas opencode.json não tem bloco references",
          fix: "rode: bun run sync",
        }
  )
}

// Relatório
console.log("")
console.log("── juninho: guia de configuração ──────────────────────────────")
let pending = 0
for (const check of checks) {
  const mark = check.ok ? "✓" : check.warn ? "⚠" : "✗"
  console.log(` ${mark} ${check.label}`)
  if (!check.ok && check.fix) {
    console.log(`   → ${check.fix}`)
    pending += 1
  }
}
console.log("")
if (pending === 0) {
  console.log(" Tudo pronto. Fluxo: /j.spec → /j.plan → /j.implement → /j.check → /j.unify")
  console.log(" Comandos úteis: bun run config:show · bun run state:show · bun run eval")
} else {
  console.log(` ${pending} item(ns) pendente(s) acima. Rode 'bun run setup' de novo após resolver.`)
}
console.log("────────────────────────────────────────────────────────────────")
console.log("")
