import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import path from "path"
import { resolveStateFile } from "../lib/j.state-paths"
import { loadActivePlanTarget, loadActivePlanTargets, resolveActivePlanStateFile, resolvePathFromProjectRoot, resolveProjectPaths } from "../lib/j.workspace-paths"
import { argFilePath, toolIs } from "../lib/j.tool-compat"
import { loadJuninhoConfig } from "../lib/j.juninho-config"

// Scope-guard: after any Write/Edit, checks if the modified file is part of
// the current plan. If it drifts outside the plan scope, appends a warning.
// Uses tool.execute.after on Write/Edit — agent sees the warning and can
// course-correct before continuing.
//
// Blocking mode: when workflow.implement.enforcePlanScope is true, a
// tool.execute.before hook throws on out-of-scope Write/Edit instead of only
// warning after the fact. Workflow bookkeeping paths (docs/, .opencode/,
// AGENTS.md) stay writable even under enforcement. Config is re-read per call
// (small file) so the toggle works without restarting opencode.

function extractPlanFiles(planContent: string): Set<string> {
  const files = new Set<string>()
  // Matches common plan file references: paths with extensions, bullet paths, etc.
  const pathPattern = /(?:^|\s|\/|\|)[\w\-./]+\.[a-zA-Z0-9]{1,12}\b/g
  for (const match of planContent.matchAll(pathPattern)) {
    const cleaned = match[0].replace(/^[\s/|]+/, "").trim()
    if (cleaned.endsWith(".") || cleaned.length < 4) continue
    files.add(cleaned)
  }
  // Backtick-quoted tokens cover extensionless files (Dockerfile, Makefile)
  // — plans list their Files entries as `path`.
  for (const match of planContent.matchAll(/`([\w\-./]+)`/g)) {
    if (match[1].length < 3) continue
    files.add(match[1])
  }
  return files
}

function isInPlanScope(planFiles: Set<string>, relPath: string): boolean {
  return [...planFiles].some(
    (pf) => relPath.endsWith(pf) || relPath.includes(pf) || pf.includes(relPath)
  )
}

// Paths that stay writable even when enforcePlanScope blocks out-of-scope
// edits: docs (specs, domain, principles), harness files, and agent
// instruction files are workflow bookkeeping, not plan-scope drift.
function isEnforcementExempt(relPath: string): boolean {
  if (/(^|\/)docs\//.test(relPath)) return true
  if (/(^|\/)\.opencode\//.test(relPath)) return true
  if (path.basename(relPath) === "AGENTS.md") return true
  return false
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
  const planFilesBySession = new Map<string, { planPath: string; mtimeMs: number; files: Set<string> }>()
  const routingHintsBySession = new Map<string, { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }>()

  function captureRoutingHint(sessionID: string, hint: { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string }): void {
    const existing = routingHintsBySession.get(sessionID) ?? {}
    routingHintsBySession.set(sessionID, {
      ...existing,
      ...Object.fromEntries(Object.entries(hint).filter(([, value]) => typeof value === "string" && value.trim().length > 0)),
    })
  }

  function loadActivePlanContent(directory: string, sessionID?: string): { planPath: string; content: string } | null {
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
        return { planPath: resolvedPath, content: readFileSync(resolvedPath, "utf-8") }
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

    return { planPath: resolvedPlan, content: readFileSync(resolvedPlan, "utf-8") }
  }

  function planMtimeMs(planPath: string): number {
    try {
      return statSync(planPath).mtimeMs
    } catch {
      return 0
    }
  }

  // Cached per session, revalidated on every use: a changed plan path, a
  // changed mtime, or an empty cached set (no plan yet / no files matched)
  // triggers a recompute — so editing plan.md mid-session actually unblocks.
  function getPlanFiles(sessionID: string): Set<string> {
    const plan = loadActivePlanContent(directory, sessionID)
    if (!plan) {
      planFilesBySession.delete(sessionID)
      return new Set()
    }

    const mtimeMs = planMtimeMs(plan.planPath)
    const cached = planFilesBySession.get(sessionID)
    if (cached && cached.planPath === plan.planPath && cached.mtimeMs === mtimeMs && cached.files.size > 0) {
      return cached.files
    }

    const files = extractPlanFiles(plan.content)
    planFilesBySession.set(sessionID, { planPath: plan.planPath, mtimeMs, files })
    return files
  }

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: any }
    ) => {
      if (!toolIs(input.tool, "write", "edit")) return

      // Re-read config per call so toggling enforcePlanScope takes effect
      // without restarting opencode, like the rest of the harness.
      const config = loadJuninhoConfig(directory)
      if (config.workflow?.implement?.enforcePlanScope !== true) return

      const filePath = argFilePath(output.args)
      if (!filePath) return

      const planFiles = getPlanFiles(input.sessionID)

      // No plan loaded — nothing to enforce
      if (planFiles.size === 0) return

      const relPath = path.relative(directory, filePath).replace(/\\/g, "/")
      if (isEnforcementExempt(relPath)) return
      if (isInPlanScope(planFiles, relPath)) return

      throw new Error(
        "[intent-gate] BLOCKED: " + relPath + " is not in the active plan's file scope. " +
        "Add it via a follow-up task, ask the developer, or disable workflow.implement.enforcePlanScope."
      )
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (toolIs(input.tool, "task")) {
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

      if (!toolIs(input.tool, "read", "write", "edit")) return

      const filePath = argFilePath(input.args)
      if (!filePath) return

      const scopeWarning = repoScopeWarning(directory, input.sessionID, filePath, routingHintsBySession)
      if (scopeWarning) output.output += "\n\n" + scopeWarning

      if (!toolIs(input.tool, "write", "edit")) return

      const planFiles = getPlanFiles(input.sessionID)

      // No plan loaded — nothing to guard
      if (planFiles.size === 0) return

      const relPath = path.relative(directory, filePath).replace(/\\/g, "/")

      // Check if the modified file matches any plan reference
      if (!isInPlanScope(planFiles, relPath)) {
        output.output +=
          "\n\n[intent-gate] ⚠ SCOPE WARNING: [" + relPath + "] is not referenced in the current plan. " +
          "Verify this change is necessary for the current task before continuing."
      }
    },
  }
}) satisfies Plugin
