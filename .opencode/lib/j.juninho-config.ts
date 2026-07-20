import { existsSync, readFileSync } from "fs"
import path from "path"
import { resolveProjectPaths } from "./j.workspace-paths"

export type ModelTiers = {
  strong?: string
  medium?: string
  weak?: string
}

export type JuninhoConfig = {
  models?: ModelTiers
  workflow?: {
    automation?: {
      nonInteractive?: boolean
      autoApproveArtifacts?: boolean
      idleNotifications?: boolean
      idleNotificationsOnlyWhenBackground?: boolean
      idleNotificationsSilent?: boolean
      idleNotificationSound?: string
    }
    implement?: {
      preCommitScope?: string
      skipLintOnPrecommit?: boolean
      skipTestOnPrecommit?: boolean
      postImplementFullCheck?: boolean
      reenterImplementOnFullCheckFailure?: boolean
      maxCheckReentries?: number
      autoFixFormatOnCommit?: boolean
      enforcePlanScope?: boolean
      watchdogSessionStale?: boolean
      refreshExecutionHeartbeat?: boolean
      singleTaskMode?: boolean
    }
    review?: {
      plan?: boolean
      implement?: boolean
      maxAttempts?: number
    }
    telemetry?: {
      enabled?: boolean
    }
    unify?: {
      enabled?: boolean
      updatePersistentContext?: boolean
      updateDomainDocs?: boolean
      updateDomainIndex?: boolean
      cleanupIntegratedTaskBookkeeping?: boolean
      commitDocUpdates?: boolean
      commitFeatureArtifacts?: boolean
      createPullRequest?: boolean
      createDeliveryPrBody?: boolean
      proposeKnowledgePromotion?: boolean
    }
    documentation?: {
      preferAgentsMdForLocalRules?: boolean
      preferDomainDocsForBusinessBehavior?: boolean
      preferPrincipleDocsForCrossCuttingTech?: boolean
      syncMarkers?: boolean
      replicateSpecToTargetRepos?: boolean
    }
  }
}

const DEFAULT_CONFIG: JuninhoConfig = {
  workflow: {
    automation: {
      nonInteractive: false,
      autoApproveArtifacts: false,
      idleNotifications: true,
      idleNotificationsOnlyWhenBackground: true,
      idleNotificationsSilent: false,
      idleNotificationSound: "Glass",
    },
    implement: {
      preCommitScope: "related",
      skipLintOnPrecommit: false,
      skipTestOnPrecommit: false,
      postImplementFullCheck: true,
      reenterImplementOnFullCheckFailure: true,
      maxCheckReentries: 2,
      autoFixFormatOnCommit: true,
      enforcePlanScope: false,
      watchdogSessionStale: true,
      refreshExecutionHeartbeat: false,
      singleTaskMode: false,
    },
    review: {
      plan: true,
      implement: true,
      maxAttempts: 2,
    },
    unify: {
      enabled: true,
      updatePersistentContext: true,
      updateDomainDocs: true,
      updateDomainIndex: true,
      cleanupIntegratedTaskBookkeeping: true,
      commitDocUpdates: true,
      commitFeatureArtifacts: false,
      createPullRequest: true,
      createDeliveryPrBody: true,
      proposeKnowledgePromotion: true,
    },
    telemetry: {
      enabled: true,
    },
    documentation: {
      preferAgentsMdForLocalRules: true,
      preferDomainDocsForBusinessBehavior: true,
      preferPrincipleDocsForCrossCuttingTech: true,
      syncMarkers: true,
      replicateSpecToTargetRepos: false,
    },
  },
}

function ancestorConfigCandidates(directory: string): string[] {
  const candidates: string[] = []
  let current = path.resolve(directory)

  while (true) {
    candidates.push(path.join(current, ".opencode", "juninho-config.json"))
    candidates.push(path.join(current, "juninho-config.json"))

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return candidates
}

export function loadJuninhoConfig(directory: string): JuninhoConfig {
  const configCandidates = [
    path.join(directory, ".opencode", "juninho-config.json"),
    path.join(directory, "juninho-config.json"),
  ]
  const projectPaths = resolveProjectPaths(directory)
  if (projectPaths) {
    configCandidates.push(path.join(projectPaths.projectRoot, ".opencode", "juninho-config.json"))
  }

  for (const configPath of configCandidates) {
    if (!existsSync(configPath)) continue
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as JuninhoConfig
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        workflow: {
          ...DEFAULT_CONFIG.workflow,
          ...parsed.workflow,
          automation: {
            ...DEFAULT_CONFIG.workflow?.automation,
            ...parsed.workflow?.automation,
          },
          implement: {
            ...DEFAULT_CONFIG.workflow?.implement,
            ...parsed.workflow?.implement,
          },
          review: {
            ...DEFAULT_CONFIG.workflow?.review,
            ...parsed.workflow?.review,
          },
          unify: {
            ...DEFAULT_CONFIG.workflow?.unify,
            ...parsed.workflow?.unify,
          },
          documentation: {
            ...DEFAULT_CONFIG.workflow?.documentation,
            ...parsed.workflow?.documentation,
          },
        },
      }
    } catch {
      // Try next config candidate.
    }
  }

  for (const configPath of ancestorConfigCandidates(directory)) {
    if (!existsSync(configPath)) continue
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as JuninhoConfig
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        workflow: {
          ...DEFAULT_CONFIG.workflow,
          ...parsed.workflow,
          automation: {
            ...DEFAULT_CONFIG.workflow?.automation,
            ...parsed.workflow?.automation,
          },
          implement: {
            ...DEFAULT_CONFIG.workflow?.implement,
            ...parsed.workflow?.implement,
          },
          review: {
            ...DEFAULT_CONFIG.workflow?.review,
            ...parsed.workflow?.review,
          },
          unify: {
            ...DEFAULT_CONFIG.workflow?.unify,
            ...parsed.workflow?.unify,
          },
          documentation: {
            ...DEFAULT_CONFIG.workflow?.documentation,
            ...parsed.workflow?.documentation,
          },
        },
      }
    } catch {
      // Try next config candidate.
    }
  }

  return DEFAULT_CONFIG
}
