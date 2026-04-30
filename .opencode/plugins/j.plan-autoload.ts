import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { loadActivePlanReferenceProjects, loadActivePlanTarget, loadActivePlanTargets, resolveActivePlanStateFile, resolvePathFromProjectRoot, resolveProjectPaths } from "../lib/j.workspace-paths"

// Injects active plan into agent context when an active-plan state pointer exists.
// Uses chat.message for initial injection, tool.execute.after(Read) as a
// fallback, and experimental.session.compacting to survive session compaction.
// The active-plan pointer stays on disk so later messages, compaction, and
// write-time guards can all resolve the same active plan consistently.

export default (async ({ directory }: { directory: string }) => {
  const planInjectedSessions = new Set<string>()
  const routingHintsBySession = new Map<string, { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>()
  const pendingHintsByParent = new Map<string, Array<{ prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>>()

  function captureRoutingHint(sessionID: string, hint: { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }): void {
    const existing = routingHintsBySession.get(sessionID) ?? {}
    routingHintsBySession.set(sessionID, {
      ...existing,
      ...Object.fromEntries(Object.entries(hint).filter(([, value]) => typeof value === "string" && value.trim().length > 0)),
    })
  }

  function loadActivePlan(sessionID?: string): { planPath: string; planContent: string; specPath?: string; contextPath?: string; targets?: Array<{ projectLabel: string; planPath: string; planContent?: string; specPath?: string; contextPath?: string }>; referenceProjects?: Array<{ projectLabel: string; reason?: string }> } | null {
    const hints = routingHintsBySession.get(sessionID ?? "")
    const activePlanFile = resolveActivePlanStateFile(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: hints?.planPath,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    })
    if (!existsSync(activePlanFile)) return null

    const state = loadActivePlanTarget(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: hints?.planPath,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    }) ?? JSON.parse(readFileSync(activePlanFile, "utf-8")) as { planPath?: string; specPath?: string; contextPath?: string; targetRepoRoot?: string }
    const planPath = state.planPath?.trim()
    if (!planPath) return null
    const projectPaths = resolveProjectPaths(directory, {
      targetRepoRoot: state.targetRepoRoot,
      planPath,
      specPath: state.specPath,
      contextPath: state.contextPath,
    })
    // Workspace-relative paths (e.g. docs/specs/foo/plan.md) resolve from workspace root (directory)
    // Absolute paths stay absolute. Only target-repo-relative paths use projectRoot.
    const fullPath = path.isAbsolute(planPath)
      ? planPath
      : planPath.startsWith("docs/specs/")
        ? path.join(directory, planPath)
        : projectPaths
          ? resolvePathFromProjectRoot(projectPaths.projectRoot, planPath)
          : path.join(directory, planPath)
    if (!existsSync(fullPath)) return null

    return {
      planPath,
      planContent: readFileSync(fullPath, "utf-8"),
      specPath: state.specPath?.trim() || undefined,
      contextPath: state.contextPath?.trim() || undefined,
      targets: loadActivePlanTargets(directory, {
        preferProjectState: true,
        prompt: hints?.prompt,
        targetRepoRoot: hints?.targetRepoRoot,
        planPath: hints?.planPath,
        specPath: hints?.specPath,
        contextPath: hints?.contextPath,
        taskContractPath: hints?.taskContractPath,
      })
        .map((target) => {
          const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: target.targetRepoRoot, planPath: target.planPath })
          if (!projectPaths || !target.planPath) return null
          // Workspace-relative paths (e.g. docs/specs/foo/plan.md) resolve from workspace root
          const targetPlanFullPath = path.isAbsolute(target.planPath)
            ? target.planPath
            : target.planPath.startsWith("docs/specs/")
              ? path.join(directory, target.planPath)
              : resolvePathFromProjectRoot(projectPaths.projectRoot, target.planPath)
          const targetPlanContent = existsSync(targetPlanFullPath) ? readFileSync(targetPlanFullPath, "utf-8") : undefined
          return {
            projectLabel: projectPaths.projectLabel,
            planPath: target.planPath,
            planContent: targetPlanContent,
            specPath: target.specPath?.trim() || undefined,
            contextPath: target.contextPath?.trim() || undefined,
          }
        })
        .filter((entry): entry is { projectLabel: string; planPath: string; planContent?: string; specPath?: string; contextPath?: string } => Boolean(entry)),
      referenceProjects: loadActivePlanReferenceProjects(directory, {
        preferProjectState: true,
        prompt: hints?.prompt,
        targetRepoRoot: hints?.targetRepoRoot,
        planPath: hints?.planPath,
        specPath: hints?.specPath,
        contextPath: hints?.contextPath,
        taskContractPath: hints?.taskContractPath,
      })
        .map((project) => {
          const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: project.targetRepoRoot })
          if (!projectPaths) return null
          return {
            projectLabel: projectPaths.projectLabel,
            reason: project.reason?.trim() || undefined,
          }
        })
        .filter((entry): entry is { projectLabel: string; reason?: string } => Boolean(entry)),
    }
  }

  function renderPlan(planPath: string, planContent: string, specPath?: string, contextPath?: string, targets?: Array<{ projectLabel: string; planPath: string; planContent?: string; specPath?: string; contextPath?: string }>, referenceProjects?: Array<{ projectLabel: string; reason?: string }>): string {
    const contractLines = [
      `[plan-autoload] Active plan detected at ${planPath}:`,
      specPath ? `[plan-autoload] Spec contract: ${specPath}` : "[plan-autoload] Spec contract: N/A",
      contextPath ? `[plan-autoload] Context contract: ${contextPath}` : "[plan-autoload] Context contract: N/A",
      ...(targets && targets.length > 1
        ? ["[plan-autoload] Multi-project write targets:", ...targets.map((target) => `- ${target.projectLabel}: plan=${target.planPath}${target.specPath ? ` spec=${target.specPath}` : ""}${target.contextPath ? ` context=${target.contextPath}` : ""}`)]
        : []),
      ...(targets && targets.length > 1
        ? ["[plan-autoload] /j.implement must iterate every write target and must not stop after the first target."]
        : []),
      ...(referenceProjects && referenceProjects.length > 0
        ? ["[plan-autoload] Reference projects:", ...referenceProjects.map((project) => `- ${project.projectLabel}${project.reason ? `: ${project.reason}` : ""}`)]
        : []),
      "",
      planContent,
      ...(targets && targets.length > 1
        ? targets
            .filter((t) => t.planContent && t.planContent !== planContent)
            .flatMap((t) => [
              "",
              `[plan-autoload] Plan content for ${t.projectLabel} (${t.planPath}):`,
              "",
              t.planContent!,
            ])
        : []),
      "",
      "Use /j.implement to execute this plan, or /j.plan to revise it.",
    ]
    return (
      contractLines.join("\n")
    )
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      if (event.type !== "session.created") return
      const sessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
      const info = typeof event.properties?.info === "object" && event.properties.info
        ? event.properties.info as Record<string, unknown>
        : undefined
      const parentID = typeof info?.parentID === "string" ? info.parentID : undefined
      if (!sessionID || !parentID) return

      const queue = pendingHintsByParent.get(parentID)
      const hint = queue?.shift()
      if (!hint) return
      captureRoutingHint(sessionID, hint)
      if (queue && queue.length > 0) pendingHintsByParent.set(parentID, queue)
      else pendingHintsByParent.delete(parentID)
    },

    "chat.message": async (
      input: { sessionID: string },
      output: { message: { system?: string }; parts: unknown[] }
    ) => {
      if (planInjectedSessions.has(input.sessionID)) return

      const loaded = loadActivePlan(input.sessionID)
      if (!loaded) return

      planInjectedSessions.add(input.sessionID)
      output.message.system = output.message.system
        ? output.message.system + "\n\n" + renderPlan(loaded.planPath, loaded.planContent, loaded.specPath, loaded.contextPath, loaded.targets, loaded.referenceProjects)
        : renderPlan(loaded.planPath, loaded.planContent, loaded.specPath, loaded.contextPath, loaded.targets, loaded.referenceProjects)
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (input.tool !== "Read" || planInjectedSessions.has(input.sessionID)) return

      const loaded = loadActivePlan(input.sessionID)
      if (!loaded) return

      planInjectedSessions.add(input.sessionID)
      output.output += "\n\n" + renderPlan(loaded.planPath, loaded.planContent, loaded.specPath, loaded.contextPath, loaded.targets, loaded.referenceProjects)
    },

    "experimental.session.compacting": async (
      input: { sessionID?: string },
      output: { context: string[] }
    ) => {
      const loaded = loadActivePlan(input.sessionID)
      if (!loaded) return

      output.context.push(renderPlan(loaded.planPath, loaded.planContent, loaded.specPath, loaded.contextPath, loaded.targets, loaded.referenceProjects))
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return
      const prompt = typeof output.args?.prompt === "string" ? output.args.prompt.trim() : ""
      const contractArg = typeof output.args?.contract === "object" && output.args.contract
        ? output.args.contract as Record<string, unknown>
        : null
      captureRoutingHint(input.sessionID, {
        prompt,
        targetRepoRoot: typeof contractArg?.targetRepoRoot === "string" ? contractArg.targetRepoRoot : undefined,
        planPath: typeof contractArg?.planPath === "string" ? contractArg.planPath : undefined,
        specPath: typeof contractArg?.specPath === "string" ? contractArg.specPath : undefined,
        contextPath: typeof contractArg?.contextPath === "string" ? contractArg.contextPath : undefined,
        taskContractPath: typeof contractArg?.taskContractPath === "string" ? contractArg.taskContractPath : undefined,
      })
      const queue = pendingHintsByParent.get(input.sessionID) ?? []
      queue.push({
        prompt,
        targetRepoRoot: typeof contractArg?.targetRepoRoot === "string" ? contractArg.targetRepoRoot : undefined,
        planPath: typeof contractArg?.planPath === "string" ? contractArg.planPath : undefined,
        specPath: typeof contractArg?.specPath === "string" ? contractArg.specPath : undefined,
        contextPath: typeof contractArg?.contextPath === "string" ? contractArg.contextPath : undefined,
        taskContractPath: typeof contractArg?.taskContractPath === "string" ? contractArg.taskContractPath : undefined,
      })
      pendingHintsByParent.set(input.sessionID, queue)
    },
  }
}) satisfies Plugin
