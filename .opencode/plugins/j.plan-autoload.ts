import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { loadActivePlanReferenceProjects, loadActivePlanTarget, loadActivePlanTargets, resolveActivePlanStateFile, resolvePathFromProjectRoot, resolveProjectPaths } from "../lib/j.workspace-paths"
import { resolveSkillPath } from "../lib/j.skill-map"
import { toolIs } from "../lib/j.tool-compat"

// Injects active plan into agent context when an active-plan state pointer exists.
// Uses chat.message for initial injection, tool.execute.after(Read) as a
// fallback, and experimental.session.compacting to survive session compaction.
// The active-plan pointer stays on disk so later messages, compaction, and
// write-time guards can all resolve the same active plan consistently.
//
// Task-scoped sessions also receive the SKILL.md of every skill their task
// declares on its "- **Skills**:" line. That line is the plan's own contract for
// which conventions a task must follow; without this it is decorative prose,
// and the only real mechanism is j.skill-inject's file-pattern match, which
// fires late (after a Read) and never for a file the task creates from scratch.

type PlanRoutingHint = { prompt?: string; targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string; taskID?: string }

type ActivePlan = {
  planPath: string
  planContent: string
  specPath?: string
  contextPath?: string
  targets?: Array<{ projectLabel: string; planPath: string; planContent?: string; specPath?: string; contextPath?: string }>
  referenceProjects?: Array<{ projectLabel: string; reason?: string }>
  // Reference path for skill resolution (project > context > workspace): the
  // resolved target project root, falling back to the plan file itself.
  skillRef?: string
}

// A task's skills are injected whole, and context skills run 12-20KB. Three is
// the ceiling the planner's own task template stays under; the byte budget is
// the backstop for a task that declares three large ones.
const MAX_TASK_SKILLS = 3
const MAX_TASK_SKILL_BYTES = 12_000

// Extracts the "## Task {id}" block from a plan so task-scoped child sessions
// receive only their own section instead of the entire plan (which can be
// tens of KB and is re-paid on every compaction).
function extractTaskSection(planContent: string, taskID: string): string | null {
  const headings = Array.from(planContent.matchAll(/^##\s+Task\s+([A-Za-z0-9_-]+)\b[^\n]*$/gm))
  const heading = headings.find((candidate) => candidate[1] === taskID)
  if (!heading || heading.index === undefined) return null
  const next = headings.find((candidate) => (candidate.index ?? 0) > heading.index!)
  return planContent.slice(heading.index, next?.index ?? planContent.length).trim()
}

// Reads the task's declared skills off its "- **Skills**: a, b, c" line.
// "None"/"N/A" are the planner's own way of declaring no skills.
function parseDeclaredSkills(taskSection: string): string[] {
  const match = taskSection.match(/^[-*]\s*\*\*Skills\*\*:\s*(.+)$/m)
  if (!match) return []
  const seen = new Set<string>()
  return match[1]
    .split(",")
    .map((name) => name.trim().replace(/^`+|`+$/g, "").trim())
    .filter((name) => name.length > 0 && !/^(none|n\/a|-)$/i.test(name))
    .filter((name) => (seen.has(name) ? false : (seen.add(name), true)))
}

export default (async ({ directory }: { directory: string }) => {
  const planInjectedSessions = new Set<string>()
  const routingHintsBySession = new Map<string, PlanRoutingHint>()
  const pendingHintsByParent = new Map<string, PlanRoutingHint[]>()
  // Each declared skill is paid for at most once per session — including across
  // compaction, where re-injecting 12KB of conventions is exactly the context
  // tax task-scoping exists to cut.
  const injectedTaskSkills = new Set<string>()

  function captureRoutingHint(sessionID: string, hint: PlanRoutingHint): void {
    const existing = routingHintsBySession.get(sessionID) ?? {}
    routingHintsBySession.set(sessionID, {
      ...existing,
      ...Object.fromEntries(Object.entries(hint).filter(([, value]) => typeof value === "string" && value.trim().length > 0)),
    })
  }

  function loadActivePlan(sessionID?: string): ActivePlan | null {
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
      // The target repo root is what makes "project > context > workspace"
      // resolvable: a skill declared by a task must resolve against the repo the
      // task writes to, not against the workspace the agent happens to run in.
      skillRef: projectPaths?.projectRoot ?? fullPath,
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

  // Renders the SKILL.md of each skill the task declares. A declared skill that
  // does not resolve is reported, never silently dropped: a plan citing a
  // non-existent skill is a defect in the plan, and the implementer would
  // otherwise write the file believing it had the conventions.
  function renderTaskSkills(taskSection: string, sessionID?: string, skillRef?: string): string[] {
    const declared = parseDeclaredSkills(taskSection)
    if (declared.length === 0) return []

    const lines: string[] = []
    const budgeted = declared.slice(0, MAX_TASK_SKILLS)
    const dropped = declared.slice(MAX_TASK_SKILLS)
    if (dropped.length > 0) {
      lines.push(
        `[plan-autoload] Skill budget: task declares ${declared.length} skills, injecting the first ${MAX_TASK_SKILLS}. Not injected: ${dropped.join(", ")} — read from disk if the task needs them.`
      )
    }

    let usedBytes = 0
    for (const skill of budgeted) {
      const key = `${sessionID ?? ""}::${skill}`
      if (injectedTaskSkills.has(key)) continue
      injectedTaskSkills.add(key)

      const skillPath = resolveSkillPath(directory, skill, skillRef)
      if (!skillPath) {
        lines.push(
          `[plan-autoload] WARNING: Task declares skill "${skill}" but no SKILL.md resolves for it (project > context > workspace). The plan cites a skill that does not exist — treat its conventions as unknown and say so in the task report.`
        )
        continue
      }

      let skillContent: string
      try {
        skillContent = readFileSync(skillPath, "utf-8")
      } catch {
        lines.push(`[plan-autoload] WARNING: Task declares skill "${skill}" but its SKILL.md at ${skillPath} could not be read.`)
        continue
      }

      // The first declared skill is injected whatever its size: context skills
      // run 12-20KB, so a strict budget would cut every one of them and leave
      // the declaration decorative again. Later skills must fit the budget.
      if (usedBytes > 0 && usedBytes + skillContent.length > MAX_TASK_SKILL_BYTES) {
        lines.push(
          `[plan-autoload] Skill budget exhausted (~${MAX_TASK_SKILL_BYTES} bytes): "${skill}" not injected. Read it from ${skillPath}.`
        )
        continue
      }
      usedBytes += skillContent.length
      lines.push("", `[plan-autoload] Skill declared by Task — ${skill}:`, "", skillContent)
      // Never spend the budget silently: an oversized first skill is a signal
      // the skill itself needs trimming, and only the reader can see that.
      if (usedBytes > MAX_TASK_SKILL_BYTES) {
        lines.push(
          "",
          `[plan-autoload] Note: "${skill}" alone is ~${Math.round(skillContent.length / 1000)}KB, over the ~${MAX_TASK_SKILL_BYTES / 1000}KB task-skill budget; any further skills this task declares are pointers only.`
        )
      }
    }

    return lines.length > 0 ? ["", ...lines] : []
  }

  function renderPlan(plan: ActivePlan, taskID?: string, sessionID?: string): string {
    const { planPath, planContent, specPath, contextPath, targets, referenceProjects } = plan
    // Task-scoped child sessions get only their task's section plus contract
    // pointers; the full plan stays on disk for dependency lookups.
    const taskSection = taskID ? extractTaskSection(planContent, taskID) : null
    if (taskID && taskSection) {
      return [
        `[plan-autoload] Active plan at ${planPath} — task-scoped session for Task ${taskID}.`,
        specPath ? `[plan-autoload] Spec contract: ${specPath}` : "[plan-autoload] Spec contract: N/A",
        contextPath ? `[plan-autoload] Context contract: ${contextPath}` : "[plan-autoload] Context contract: N/A",
        `[plan-autoload] Only Task ${taskID}'s plan section is shown below. Read the full plan from disk only if a declared dependency requires it.`,
        "",
        taskSection,
        ...renderTaskSkills(taskSection, sessionID, plan.skillRef),
      ].join("\n")
    }

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
      if (!queue || queue.length === 0) return

      // The queue can desync from session creation (a task call may fail after
      // the before-hook, or resume an existing session, without ever emitting
      // session.created). The child session title carries the task prompt, so
      // it is authoritative for taskID: match the queued hint by it when
      // possible, and never trust a queued taskID the title does not confirm.
      const title = typeof info?.title === "string" ? info.title : ""
      const titleTaskID = title.match(/execute task ([A-Za-z0-9_-]+)/i)?.[1]
      const matchedIndex = titleTaskID ? queue.findIndex((candidate) => candidate.taskID === titleTaskID) : -1
      const hint = matchedIndex >= 0 ? queue.splice(matchedIndex, 1)[0] : queue.shift()
      if (!hint) return
      captureRoutingHint(sessionID, { ...hint, taskID: titleTaskID })
      if (queue.length > 0) pendingHintsByParent.set(parentID, queue)
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
      const taskID = routingHintsBySession.get(input.sessionID)?.taskID
      const rendered = renderPlan(loaded, taskID, input.sessionID)
      output.message.system = output.message.system ? output.message.system + "\n\n" + rendered : rendered
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (!toolIs(input.tool, "read") || planInjectedSessions.has(input.sessionID)) return

      const loaded = loadActivePlan(input.sessionID)
      if (!loaded) return

      planInjectedSessions.add(input.sessionID)
      const taskID = routingHintsBySession.get(input.sessionID)?.taskID
      output.output += "\n\n" + renderPlan(loaded, taskID, input.sessionID)
    },

    "experimental.session.compacting": async (
      input: { sessionID?: string },
      output: { context: string[] }
    ) => {
      const loaded = loadActivePlan(input.sessionID)
      if (!loaded) return

      const taskID = input.sessionID ? routingHintsBySession.get(input.sessionID)?.taskID : undefined
      output.context.push(renderPlan(loaded, taskID, input.sessionID))
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (!toolIs(input.tool, "task")) return
      const prompt = typeof output.args?.prompt === "string" ? output.args.prompt.trim() : ""
      const contractArg = typeof output.args?.contract === "object" && output.args.contract
        ? output.args.contract as Record<string, unknown>
        : null
      const hint: PlanRoutingHint = {
        prompt,
        targetRepoRoot: typeof contractArg?.targetRepoRoot === "string" ? contractArg.targetRepoRoot : undefined,
        planPath: typeof contractArg?.planPath === "string" ? contractArg.planPath : undefined,
        specPath: typeof contractArg?.specPath === "string" ? contractArg.specPath : undefined,
        contextPath: typeof contractArg?.contextPath === "string" ? contractArg.contextPath : undefined,
        taskContractPath: typeof contractArg?.taskContractPath === "string" ? contractArg.taskContractPath : undefined,
      }
      // The parent (workflow owner) keeps only path hints; taskID is a
      // child-session property, otherwise the owner itself would render as
      // task-scoped on compaction.
      captureRoutingHint(input.sessionID, hint)
      const taskID = typeof contractArg?.taskID === "string"
        ? contractArg.taskID
        : typeof contractArg?.taskID === "number"
          ? String(contractArg.taskID)
          : prompt.match(/^Execute task ([A-Za-z0-9_-]+)/i)?.[1]
      const queue = pendingHintsByParent.get(input.sessionID) ?? []
      queue.push({ ...hint, taskID })
      pendingHintsByParent.set(input.sessionID, queue)
    },
  }
}) satisfies Plugin
