import { readConfig, die, ok } from "./_lib"
import type { JuninhoConfig } from "../lib/j.juninho-config"

const ALLOWED_TOP = new Set([
  "strong",
  "medium",
  "weak",
  "projectType",
  "isKotlin",
  "buildTool",
  "workflow",
])

const ALLOWED_WORKFLOW = new Set([
  "automation",
  "implement",
  "unify",
  "graphify",
  "documentation",
])

const ALLOWED_AUTOMATION = new Set([
  "nonInteractive",
  "autoApproveArtifacts",
])

const ALLOWED_IMPLEMENT = new Set([
  "preCommitScope",
  "skipLintOnPrecommit",
  "skipTestOnPrecommit",
  "postImplementFullCheck",
  "reenterImplementOnFullCheckFailure",
  "watchdogSessionStale",
  "refreshExecutionHeartbeat",
])

const ALLOWED_UNIFY = new Set([
  "enabled",
  "updatePersistentContext",
  "updateDomainDocs",
  "updateDomainIndex",
  "cleanupIntegratedTaskBookkeeping",
  "commitDocUpdates",
  "refreshGraphify",
  "commitFeatureArtifacts",
  "createPullRequest",
  "createDeliveryPrBody",
])

const ALLOWED_GRAPHIFY = new Set([
  "enabled",
  "outputDir",
  "staleAfterDays",
  "maxCacheMb",
  "installMethod",
])

const ALLOWED_DOCUMENTATION = new Set([
  "preferAgentsMdForLocalRules",
  "preferDomainDocsForBusinessBehavior",
  "preferPrincipleDocsForCrossCuttingTech",
  "syncMarkers",
])

function unknownKeys(obj: Record<string, any>, allowed: Set<string>, scope: string): string[] {
  return Object.keys(obj)
    .filter((k) => !allowed.has(k))
    .map((k) => `${scope}.${k}`)
}

const config = readConfig() as Record<string, any> & JuninhoConfig
const issues: string[] = []

issues.push(...unknownKeys(config, ALLOWED_TOP, "root"))

const wf = config.workflow ?? {}
issues.push(...unknownKeys(wf, ALLOWED_WORKFLOW, "workflow"))
if (wf.automation) issues.push(...unknownKeys(wf.automation, ALLOWED_AUTOMATION, "workflow.automation"))
if (wf.implement) issues.push(...unknownKeys(wf.implement, ALLOWED_IMPLEMENT, "workflow.implement"))
if (wf.unify) issues.push(...unknownKeys(wf.unify, ALLOWED_UNIFY, "workflow.unify"))
if (wf.graphify) issues.push(...unknownKeys(wf.graphify, ALLOWED_GRAPHIFY, "workflow.graphify"))
if (wf.documentation) issues.push(...unknownKeys(wf.documentation, ALLOWED_DOCUMENTATION, "workflow.documentation"))

if (typeof config.strong !== "string") issues.push("root.strong precisa ser string")
if (typeof config.medium !== "string") issues.push("root.medium precisa ser string")
if (typeof config.weak !== "string") issues.push("root.weak precisa ser string")

if (issues.length > 0) {
  die(`config inválida:\n  - ${issues.join("\n  - ")}`)
}

ok("config válida")
ok(`  strong:  ${config.strong}`)
ok(`  medium:  ${config.medium}`)
ok(`  weak:    ${config.weak}`)
ok(`  project: ${config.projectType ?? "(default)"}`)
