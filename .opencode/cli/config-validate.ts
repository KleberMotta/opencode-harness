import { readConfig, die, ok } from "./_lib"
import type { JuninhoConfig } from "../lib/j.juninho-config"

const ALLOWED_TOP = new Set([
  "models",
  "workflow",
])

const ALLOWED_WORKFLOW = new Set([
  "automation",
  "implement",
  "unify",
  "documentation",
  "telemetry",
])

const ALLOWED_TELEMETRY = new Set([
  "enabled",
])

const ALLOWED_AUTOMATION = new Set([
  "nonInteractive",
  "autoApproveArtifacts",
  "idleNotifications",
])

const ALLOWED_IMPLEMENT = new Set([
  "preCommitScope",
  "skipLintOnPrecommit",
  "skipTestOnPrecommit",
  "postImplementFullCheck",
  "reenterImplementOnFullCheckFailure",
  "maxCheckReentries",
  "autoFixFormatOnCommit",
  "enforcePlanScope",
  "watchdogSessionStale",
  "refreshExecutionHeartbeat",
  "singleTaskMode",
])

const ALLOWED_UNIFY = new Set([
  "enabled",
  "updatePersistentContext",
  "updateDomainDocs",
  "updateDomainIndex",
  "cleanupIntegratedTaskBookkeeping",
  "commitDocUpdates",
  "commitFeatureArtifacts",
  "createPullRequest",
  "createDeliveryPrBody",
  "proposeKnowledgePromotion",
])

const ALLOWED_DOCUMENTATION = new Set([
  "preferAgentsMdForLocalRules",
  "preferDomainDocsForBusinessBehavior",
  "preferPrincipleDocsForCrossCuttingTech",
  "syncMarkers",
  "replicateSpecToTargetRepos",
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
if (wf.documentation) issues.push(...unknownKeys(wf.documentation, ALLOWED_DOCUMENTATION, "workflow.documentation"))
if (wf.telemetry) issues.push(...unknownKeys(wf.telemetry, ALLOWED_TELEMETRY, "workflow.telemetry"))

if (issues.length > 0) {
  die(`config inválida:\n  - ${issues.join("\n  - ")}`)
}

ok("config válida")
ok(`  models.strong: ${config.models?.strong ?? "(not set)"}`)
ok(`  models.medium: ${config.models?.medium ?? "(not set)"}`)
ok(`  models.weak:   ${config.models?.weak ?? "(not set)"}`)
