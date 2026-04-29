import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { resolveStateFile } from "../lib/j.state-paths"
import { loadActivePlanTarget, loadActivePlanTargets, resolveActivePlanStateFile, resolvePathFromProjectRoot, resolveProjectPaths } from "../lib/j.workspace-paths"

// Scope-guard: after any Write/Edit, checks if the modified file is part of
// the current plan. If it drifts outside the plan scope, appends a warning.
// Uses tool.execute.after on Write/Edit — agent sees the warning and can
// course-correct before continuing.

function extractPlanFiles(planContent: string): Set<string> {
  const files = new Set<string>()
  // Matches common plan file references: paths with extensions, bullet paths, etc.
  const pathPattern = /(?:^|\s|\/|\|)[\w\-./]+\.[a-z]{1,5}\b/gi
  for (const match of planContent.matchAll(pathPattern)) {
    const cleaned = match[0].replace(/^[\s/|]+/, "").trim()
    if (cleaned.endsWith(".") || cleaned.length < 4) continue
    files.add(cleaned)
  }
  return files
}

function readDirectoryNames(target: string): string[] {
  try {
    return readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function resolveSessionProjectRoot(
  directory: string,
  sessionID: string,
  routingHintsBySession: Map<string, { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>
): string | null {
  const hints = routingHintsBySession.get(sessionID)
  const targets = loadActivePlanTargets(directory, {
    preferProjectState: true,
    prompt: hints?.prompt,
    targetRepoRoot: hints?.targetRepoRoot,
    planPath: hints?.planPath,
    specPath: hints?.specPath,
    contextPath: hints?.contextPath,
    taskContractPath: hints?.taskContractPath,
  })
  for (const target of targets) {
    if (!target.targetRepoRoot) continue
    const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: target.targetRepoRoot, planPath: target.planPath })
    const specsRoot = projectPaths?.specsRoot
    if (!specsRoot || !existsSync(specsRoot)) continue

    for (const featureSlug of readDirectoryNames(specsRoot)) {
      const runtimePath = path.join(specsRoot, featureSlug, "state", "sessions", sessionID + "-runtime.json")
      if (!existsSync(runtimePath)) continue
      try {
        const runtime = JSON.parse(readFileSync(runtimePath, "utf-8")) as { targetRepoRoot?: string }
        return runtime.targetRepoRoot?.trim() || target.targetRepoRoot
      } catch {
        return target.targetRepoRoot
      }
    }
  }

  return loadActivePlanTarget(directory, {
    preferProjectState: true,
    prompt: hints?.prompt,
    targetRepoRoot: hints?.targetRepoRoot,
    planPath: hints?.planPath,
    specPath: hints?.specPath,
    contextPath: hints?.contextPath,
    taskContractPath: hints?.taskContractPath,
  })?.targetRepoRoot?.trim() || null
}

function repoScopeWarning(
  directory: string,
  sessionID: string,
  filePath: string,
  routingHintsBySession: Map<string, { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>
): string | null {
  if (!path.isAbsolute(filePath)) return null

  const targetProjectRoot = resolveSessionProjectRoot(directory, sessionID, routingHintsBySession)
  if (!targetProjectRoot) return null

  const normalizedFilePath = path.resolve(filePath)
  const harnessRoot = path.join(directory, ".opencode")
  if (normalizedFilePath.startsWith(targetProjectRoot)) return null
  if (normalizedFilePath.startsWith(harnessRoot)) return null

  const relPath = path.relative(directory, normalizedFilePath).replace(/\\/g, "/")
  const relTarget = path.relative(directory, targetProjectRoot).replace(/\\/g, "/")
  return "[intent-gate] REPO WARNING: [" + relPath + "] is outside the current task/project scope. This session is scoped to [" + relTarget + "]."
}

export default (async ({ directory }: { directory: string }) => {
  const planFilesBySession = new Map<string, Set<string>>()
  const routingHintsBySession = new Map<string, { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>()

  function captureRoutingHint(sessionID: string, hint: { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }): void {
    const existing = routingHintsBySession.get(sessionID) ?? {}
    routingHintsBySession.set(sessionID, {
      ...existing,
      ...Object.fromEntries(Object.entries(hint).filter(([, value]) => typeof value === "string" && value.trim().length > 0)),
    })
  }

  function loadActivePlanContent(directory: string, sessionID?: string): string | null {
    const hints = routingHintsBySession.get(sessionID ?? "")
    const activePlanPath = resolveActivePlanStateFile(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: hints?.planPath,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    })
    if (existsSync(activePlanPath)) {
      const activePlan = loadActivePlanTarget(directory, {
        preferProjectState: true,
        prompt: hints?.prompt,
        targetRepoRoot: hints?.targetRepoRoot,
        planPath: hints?.planPath,
        specPath: hints?.specPath,
        contextPath: hints?.contextPath,
        taskContractPath: hints?.taskContractPath,
      }) ?? JSON.parse(readFileSync(activePlanPath, "utf-8")) as { planPath?: string; targetRepoRoot?: string }
      const declaredPath = activePlan.planPath?.trim()
      if (!declaredPath) return null
      const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: activePlan.targetRepoRoot, planPath: declaredPath })
      const resolvedPath = path.isAbsolute(declaredPath)
        ? declaredPath
        : projectPaths
          ? resolvePathFromProjectRoot(projectPaths.projectRoot, declaredPath)
          : path.join(directory, declaredPath)
      if (existsSync(resolvedPath)) {
        return readFileSync(resolvedPath, "utf-8")
      }
    }

    const statePath = resolveStateFile(directory, "execution-state.md")
    if (!existsSync(statePath)) return null

    const stateContent = readFileSync(statePath, "utf-8")
    const declaredPlan = stateContent
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .find((line) => line.startsWith("**Plan**:"))
      ?.slice("**Plan**:".length)
      ?.trim()
      ?.replace(/^`/, "")
      ?.replace(/`$/, "")
      ?.trim()
    if (!declaredPlan) return null

    const activePlan = loadActivePlanTarget(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: declaredPlan,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    })
    const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: activePlan?.targetRepoRoot, planPath: declaredPlan })
    const resolvedPlan = path.isAbsolute(declaredPlan)
      ? declaredPlan
      : projectPaths
        ? resolvePathFromProjectRoot(projectPaths.projectRoot, declaredPlan)
        : path.join(directory, declaredPlan)
    if (!existsSync(resolvedPlan)) return null

    return readFileSync(resolvedPlan, "utf-8")
  }

  function resolveSessionProjectRoot(directory: string, sessionID: string): string | null {
    const hints = routingHintsBySession.get(sessionID)
    const targets = loadActivePlanTargets(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: hints?.planPath,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    })
    for (const target of targets) {
      if (!target.targetRepoRoot) continue
      const projectPaths = resolveProjectPaths(directory, { targetRepoRoot: target.targetRepoRoot, planPath: target.planPath })
      const specsRoot = projectPaths?.specsRoot
      if (!specsRoot || !existsSync(specsRoot)) continue

      for (const featureSlug of readDirectoryNames(specsRoot)) {
        const runtimePath = path.join(specsRoot, featureSlug, "state", "sessions", sessionID + "-runtime.json")
        if (!existsSync(runtimePath)) continue
        try {
          const runtime = JSON.parse(readFileSync(runtimePath, "utf-8")) as { targetRepoRoot?: string }
          return runtime.targetRepoRoot?.trim() || target.targetRepoRoot
        } catch {
          return target.targetRepoRoot
        }
      }
    }

    return loadActivePlanTarget(directory, {
      preferProjectState: true,
      prompt: hints?.prompt,
      targetRepoRoot: hints?.targetRepoRoot,
      planPath: hints?.planPath,
      specPath: hints?.specPath,
      contextPath: hints?.contextPath,
      taskContractPath: hints?.taskContractPath,
    })?.targetRepoRoot?.trim() || null
  }

  function getPlanFiles(sessionID: string): Set<string> {
    const existing = planFilesBySession.get(sessionID)
    if (existing) return existing

    const planFiles = new Set<string>()
    const content = loadActivePlanContent(directory, sessionID)
    if (content) {
      for (const file of extractPlanFiles(content)) planFiles.add(file)
    }

    planFilesBySession.set(sessionID, planFiles)
    return planFiles
  }

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (input.tool === "Task" || input.tool === "task") {
        const prompt = typeof input.args?.prompt === "string" ? input.args.prompt.trim() : ""
        const contractArg = typeof input.args?.contract === "object" && input.args.contract
          ? input.args.contract as Record<string, unknown>
          : null
        captureRoutingHint(input.sessionID, {
          prompt,
          targetRepoRoot: typeof contractArg?.targetRepoRoot === "string" ? contractArg.targetRepoRoot : undefined,
          planPath: typeof contractArg?.planPath === "string" ? contractArg.planPath : undefined,
          specPath: typeof contractArg?.specPath === "string" ? contractArg.specPath : undefined,
          contextPath: typeof contractArg?.contextPath === "string" ? contractArg.contextPath : undefined,
          taskContractPath: typeof contractArg?.taskContractPath === "string" ? contractArg.taskContractPath : undefined,
        })
        return
      }

      if (!["Read", "Write", "Edit", "MultiEdit"].includes(input.tool)) return

      const filePath: string = input.args?.path ?? input.args?.file_path ?? ""
      if (!filePath) return

      const scopeWarning = repoScopeWarning(directory, input.sessionID, filePath, routingHintsBySession)
      if (scopeWarning) output.output += "\n\n" + scopeWarning

      if (!["Write", "Edit", "MultiEdit"].includes(input.tool)) return

      const planFiles = getPlanFiles(input.sessionID)

      // No plan loaded — nothing to guard
      if (planFiles.size === 0) return

      const relPath = path.relative(directory, filePath).replace(/\\\\/g, "/")

      // Check if the modified file matches any plan reference
      const inScope = [...planFiles].some(
        (pf) => relPath.endsWith(pf) || relPath.includes(pf) || pf.includes(relPath)
      )

      if (!inScope) {
        output.output +=
          "\n\n[intent-gate] ⚠ SCOPE WARNING: [" + relPath + "] is not referenced in the current plan. " +
          "Verify this change is necessary for the current task before continuing."
      }
    },
  }
}) satisfies Plugin
