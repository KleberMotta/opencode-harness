import { existsSync, readFileSync } from "fs"
import path from "path"
import { resolveProjectPaths } from "./j.workspace-paths"

export type ModelTiers = {
  strong?: string
  medium?: string
  weak?: string
}

export type JuninhoConfig = {
  projectType?: string
  isKotlin?: boolean
  buildTool?: string
  models?: ModelTiers
  workflow?: {
    automation?: {
      nonInteractive?: boolean
      autoApproveArtifacts?: boolean
    }
    implement?: {
      preCommitScope?: string
      skipLintOnPrecommit?: boolean
      skipTestOnPrecommit?: boolean
      postImplementFullCheck?: boolean
      reenterImplementOnFullCheckFailure?: boolean
      watchdogSessionStale?: boolean
      refreshExecutionHeartbeat?: boolean
      singleTaskMode?: boolean
    }
    unify?: {
      enabled?: boolean
      updatePersistentContext?: boolean
      updateDomainDocs?: boolean
      updateDomainIndex?: boolean
      cleanupIntegratedTaskBookkeeping?: boolean
      commitDocUpdates?: boolean
      refreshGraphify?: boolean
      commitFeatureArtifacts?: boolean
      createPullRequest?: boolean
      createDeliveryPrBody?: boolean
    }
    graphify?: {
      enabled?: boolean
      outputDir?: string
      staleAfterDays?: number
      maxCacheMb?: number
      installMethod?: string
    }
    documentation?: {
      preferAgentsMdForLocalRules?: boolean
      preferDomainDocsForBusinessBehavior?: boolean
      preferPrincipleDocsForCrossCuttingTech?: boolean
      syncMarkers?: boolean
    }
  }
}

const DEFAULT_CONFIG: JuninhoConfig = {
  workflow: {
    automation: {
      nonInteractive: false,
      autoApproveArtifacts: false,
    },
    implement: {
      preCommitScope: "related",
      skipLintOnPrecommit: false,
      skipTestOnPrecommit: false,
      postImplementFullCheck: true,
      reenterImplementOnFullCheckFailure: true,
      watchdogSessionStale: true,
      refreshExecutionHeartbeat: false,
      singleTaskMode: false,
    },
    unify: {
      enabled: true,
      updatePersistentContext: true,
      updateDomainDocs: true,
      updateDomainIndex: true,
      cleanupIntegratedTaskBookkeeping: true,
      commitDocUpdates: true,
      refreshGraphify: false,
      commitFeatureArtifacts: false,
      createPullRequest: true,
      createDeliveryPrBody: true,
    },
    graphify: {
      enabled: false,
      outputDir: "docs/domain/graphify",
      staleAfterDays: 7,
      maxCacheMb: 100,
      installMethod: "pipx",
    },
    documentation: {
      preferAgentsMdForLocalRules: true,
      preferDomainDocsForBusinessBehavior: true,
      preferPrincipleDocsForCrossCuttingTech: true,
      syncMarkers: true,
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
          unify: {
            ...DEFAULT_CONFIG.workflow?.unify,
            ...parsed.workflow?.unify,
          },
          graphify: {
            ...DEFAULT_CONFIG.workflow?.graphify,
            ...parsed.workflow?.graphify,
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
          unify: {
            ...DEFAULT_CONFIG.workflow?.unify,
            ...parsed.workflow?.unify,
          },
          graphify: {
            ...DEFAULT_CONFIG.workflow?.graphify,
            ...parsed.workflow?.graphify,
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
