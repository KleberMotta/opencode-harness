import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { performance } from "perf_hooks"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { parseEvaluationFile, type EvalTask } from "./eval-parser"

type ToolMetric = {
  count: number
  durationsMs: number[]
}

type EvalResult = {
  question: string
  preferredTool?: string
  expectedAnswer?: string
  actualAnswer: string
  orchestratorFeedback: string
  toolMetrics: Record<string, ToolMetric>
  totalDurationMs: number
  totalToolCalls: number
  preferredToolUsed: boolean
  withinToolBudget: boolean | null
  withinDurationBudget: boolean | null
  exactPreferredToolMatch: boolean
  exactAnswerMatch: boolean | null
  sessionID: string | null
  transcriptPath: string
  sandboxPath: string
  taskError?: string
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function exactAnswerMatch(task: EvalTask, actualAnswer: string): boolean | null {
  if (!task.answer) return null
  return normalizeText(actualAnswer).includes(normalizeText(task.answer))
}

function parseEvents(transcriptPath: string): any[] {
  if (!existsSync(transcriptPath)) return []
  return readFileSync(transcriptPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function collectTextParts(events: any[]): string[] {
  return events
    .filter((event) => event?.type === "text")
    .map((event) => String(event?.part?.text ?? "").trim())
    .filter(Boolean)
}

function collectToolMetrics(events: any[]): Record<string, ToolMetric> {
  const metrics: Record<string, ToolMetric> = {}
  for (const event of events) {
    if (event?.type !== "tool_use") continue
    const toolName = String(event?.part?.tool ?? "")
    if (!toolName) continue
    const state = event?.part?.state ?? {}
    const duration = Number(state?.time?.end ?? 0) - Number(state?.time?.start ?? 0)
    if (!metrics[toolName]) metrics[toolName] = { count: 0, durationsMs: [] }
    metrics[toolName].count += 1
    metrics[toolName].durationsMs.push(Number.isFinite(duration) && duration > 0 ? duration : 0)
  }
  return metrics
}

function collectToolOutputs(events: any[], toolName: string): string[] {
  return events
    .filter((event) => event?.type === "tool_use" && event?.part?.tool === toolName)
    .map((event) => String(event?.part?.state?.output ?? event?.part?.state?.error ?? ""))
}

function collectToolOutputsFromExportedSession(exportedSession: any, toolName: string): string[] {
  const outputs: string[] = []
  for (const message of exportedSession?.messages ?? []) {
    for (const part of message?.parts ?? []) {
      if (part?.type !== "tool" || String(part?.tool ?? "") !== toolName) continue
      outputs.push(String(part?.state?.output ?? part?.state?.error ?? ""))
    }
  }
  return outputs
}

function collectChildSessionIDs(events: any[]): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    if (event?.type !== "tool_use" || event?.part?.tool !== "task") continue
    const childSessionID = event?.part?.state?.metadata?.sessionId
    if (typeof childSessionID === "string" && childSessionID.length > 0) ids.add(childSessionID)
  }
  return Array.from(ids)
}

function exportSession(sessionID: string): any | null {
  const exported = spawnSync("opencode", ["export", sessionID], {
    encoding: "utf-8",
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  })
  if (exported.status !== 0) return null

  const jsonStart = (exported.stdout ?? "").indexOf("{")
  if (jsonStart < 0) return null
  try {
    return JSON.parse((exported.stdout ?? "").slice(jsonStart))
  } catch {
    return null
  }
}

function exportChildSessions(events: any[]): any[] {
  return collectChildSessionIDs(events)
    .map((sessionID) => exportSession(sessionID))
    .filter(Boolean)
}

function childSessionIDsFromExportedSession(exportedSession: any): string[] {
  const ids = new Set<string>()
  for (const message of exportedSession?.messages ?? []) {
    for (const part of message?.parts ?? []) {
      if (part?.type !== "tool" || part?.tool !== "task") continue
      const childSessionID = part?.state?.metadata?.sessionId
      if (typeof childSessionID === "string" && childSessionID.length > 0) ids.add(childSessionID)
    }
  }
  return Array.from(ids)
}

function exportDescendantSessions(events: any[]): any[] {
  const exported: any[] = []
  const queue = [...collectChildSessionIDs(events)]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const sessionID = queue.shift()!
    if (seen.has(sessionID)) continue
    seen.add(sessionID)

    const session = exportSession(sessionID)
    if (!session) continue
    exported.push(session)

    for (const childID of childSessionIDsFromExportedSession(session)) {
      if (!seen.has(childID)) queue.push(childID)
    }
  }

  return exported
}

function exportedSessionAgent(exportedSession: any): string | null {
  for (const message of exportedSession?.messages ?? []) {
    const agent = message?.info?.agent
    if (typeof agent === "string" && agent.length > 0) return agent
  }
  return null
}

function childSystemPrompts(exportedSession: any): string[] {
  return (exportedSession?.messages ?? [])
    .map((message: any) => String(message?.info?.system ?? "").trim())
    .filter(Boolean)
}

function hasStartupContextLabel(systems: string[]): boolean {
  return systems.some(
    (system) =>
      system.includes("[carl-inject] Task-scoped startup context") ||
      system.includes("[carl-inject] Delegated session startup context")
  )
}

function childToolSequence(exportedSession: any): string[] {
  const tools: string[] = []
  for (const message of exportedSession?.messages ?? []) {
    for (const part of message?.parts ?? []) {
      if (part?.type === "tool" && typeof part?.tool === "string") tools.push(part.tool)
    }
  }
  return tools
}

function childReadTargets(exportedSession: any): string[] {
  const targets: string[] = []
  for (const message of exportedSession?.messages ?? []) {
    for (const part of message?.parts ?? []) {
      if (part?.type !== "tool" || part?.tool !== "read") continue
      const filePath = part?.state?.input?.filePath
      if (typeof filePath === "string") targets.push(filePath)
    }
  }
  return targets
}

function collectSessionID(events: any[]): string | null {
  for (const event of events) {
    if (typeof event?.sessionID === "string" && event.sessionID.length > 0) return event.sessionID
  }
  return null
}

function mktemp(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))

function writeExecutable(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
  spawnSync("chmod", ["+x", filePath], { stdio: "inherit" })
}

function markdownPlanTask(options: {
  id?: string
  name?: string
  files?: string[]
  action: string
  verification?: string
  done: string
  contextReference?: string
  goal?: string
}): string {
  return [
    "# Plan: Feature X",
    "",
    `- **Goal**: ${options.goal ?? "Execute feature-x."}`,
    "- **Spec**: docs/specs/feature-x/spec.md",
    "- **Context**: docs/specs/feature-x/CONTEXT.md",
    "- **Intent Type**: FEATURE",
    "- **Complexity**: MEDIUM",
    "",
    "PLAN-SANDBOX-MARKER",
    "",
    `## Task ${options.id ?? "1"} — ${options.name ?? "Update sample flow"}`,
    "- **Project**: sandbox",
    "- **Wave**: 1",
    "- **Agent**: j.implementer",
    "- **Depends**: None",
    "- **Skills**: j.service-writing",
    "",
    "### Context References",
    `- ${options.contextReference ?? "`CONTEXT.md#sandbox` — Sandbox context."}`,
    "",
    "### Files",
    ...(options.files ?? ["src/feature/SampleController.kt"]).map((file) => `- \`${file}\``),
    "",
    "### Action",
    options.action,
    "",
    "### Verification",
    `- ${options.verification ?? "Run focused verification."}`,
    "",
    "### Done Criteria",
    `- ${options.done}`,
    "",
  ].join("\n")
}

function extractControllerSkillMarker(root: string): string | null {
  const skillPath = path.join(root, ".opencode", "skills", "j.controller-writing", "SKILL.md")
  if (!existsSync(skillPath)) return null
  const match = readFileSync(skillPath, "utf-8").match(/Add the line `([^`]+)` immediately above the controller class declaration/)
  return match?.[1] ?? null
}

function extractMapperSkillMarker(root: string): string | null {
  const skillPath = path.join(root, ".opencode", "skills", "j.mapper-writing", "SKILL.md")
  if (!existsSync(skillPath)) return null
  const match = readFileSync(skillPath, "utf-8").match(/Add the line `([^`]+)` immediately above the mapper type declaration/)
  return match?.[1] ?? null
}

function seedHarnessSandbox(root: string) {
  const sourceRepo = path.resolve(currentDir, "../../..")
  cpSync(path.join(sourceRepo, "opencode.json"), path.join(root, "opencode.json"))
  cpSync(path.join(sourceRepo, ".opencode"), path.join(root, ".opencode"), { recursive: true })

  mkdirSync(path.join(root, "src", "feature"), { recursive: true })
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "configuration"), { recursive: true })
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "service"), { recursive: true })
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper"), { recursive: true })
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample", "request"), { recursive: true })
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample"), { recursive: true })
  mkdirSync(path.join(root, "docs", "principles"), { recursive: true })
  mkdirSync(path.join(root, "docs", "domain"), { recursive: true })
  mkdirSync(path.join(root, "docs", "specs", "feature-x"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "state"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "skills", "j.controller-writing"), { recursive: true })
  mkdirSync(path.join(root, ".opencode", "skills", "j.mapper-writing"), { recursive: true })
  mkdirSync(path.join(root, "migrations"), { recursive: true })

  writeFileSync(path.join(root, "AGENTS.md"), "# Root Sandbox\nMarker: ROOT-SANDBOX-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "src", "AGENTS.md"), "# Src Rules\nMarker: SRC-SANDBOX-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "src", "feature", "SampleController.kt"), "class SampleController\n", "utf-8")
  writeFileSync(path.join(root, "src", "main", "kotlin", "Foo.kt"), "class Foo\nfun bar() = 1\n", "utf-8")
  writeFileSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper", "SampleAggregateMapper.kt"), "package br.com.olx.trp.financial.domain.order.mapper\n\nclass SampleAggregateMapper\n", "utf-8")
  writeFileSync(path.join(root, "migrations", "0001_init.sql"), "-- init\n", "utf-8")

  writeFileSync(
    path.join(root, ".opencode", "skill-map.json"),
    JSON.stringify(
      [
        { pattern: "Controller\\.kt$", skill: "j.controller-writing" },
        { pattern: ".*Mapper(?:Helper)?\\.kt$", skill: "j.mapper-writing" },
        { pattern: "(^|\\/)\\.opencode\\/skills\\/[^/]+\\/SKILL\\.md$", skill: "skill-creator" },
      ],
      null,
      2
    ) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, ".opencode", "skills", "j.controller-writing", "SKILL.md"),
    `---\nname: j.controller-writing\ndescription: sandbox controller skill\n---\n\n## When this skill activates\nController files.\n\n## Required Steps\n- Marker: CONTROLLER-SKILL-MARKER\n- Reuse REQUEST_ID_HEADER\n- Delegate to SampleService\n- Add the line \`// skill-marker: controller-writing:${path.basename(root)}\` immediately above the controller class declaration\n\n## Anti-patterns to avoid\n- Business logic in controller.\n`,
    "utf-8"
  )
  writeFileSync(
    path.join(root, ".opencode", "skills", "j.mapper-writing", "SKILL.md"),
    `---\nname: j.mapper-writing\ndescription: sandbox mapper skill\n---\n\n## When this skill activates\nMapper files.\n\n## Required Steps\n- Marker: MAPPER-SKILL-MARKER\n- Prefer manual Function/BiFunction mappers for aggregate assembly\n- Avoid extension mapping functions\n- Keep mapper logic pure\n- Add the line \`// skill-marker: mapper-writing:${path.basename(root)}\` immediately above the mapper type declaration\n\n## Anti-patterns to avoid\n- Business logic in mapper.\n`,
    "utf-8"
  )

  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "API_STATE=active",
      "API_RECALL=controller",
      "API_FILE=docs/principles/api-patterns.md",
      "API_PRIORITY=1",
      "API_ALWAYS=true",
      "SUBAGENT_STATE=active",
      "SUBAGENT_RECALL=payment,settlement,samplecontroller,workflow",
      "SUBAGENT_FILE=docs/principles/subagent-patterns.md",
      "SUBAGENT_PRIORITY=2",
      "TEST_STATE=active",
      "TEST_RECALL=test,unit,integration",
      "TEST_FILE=docs/principles/test-patterns.md",
      "TEST_PRIORITY=3",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "api-patterns.md"),
    "# API Patterns\nPRINCIPLE-SANDBOX-MARKER\n- Keep controllers thin.\n- Validate at the boundary.\n- Delegate business logic once to services.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "subagent-patterns.md"),
    "# Subagent Patterns\nPRINCIPLE-SUBAGENT-MARKER\n- For payment settlement tasks, start from the task-owned file.\n- Reuse existing service and header patterns instead of exploring broadly.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "principles", "test-patterns.md"), "# Test Patterns\nTEST-DISTRACTOR-MARKER\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Orders\nKeywords: order, payment settlement, settlement workflow, release, reverse\nFiles:\n- orders.md — Order settlement workflow\n\n## Cashout\nKeywords: cashout, withdrawal, payout, transfer\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, escrow, available, ledger\nFiles:\n- balance.md — Balance movements\n\n## Subagent\nKeywords: payment, settlement, samplecontroller, workflow\nFiles:\n- subagent.md — Subagent context doc\n\n## Web\nKeywords: controller, request, response\nFiles:\n- web.md — Generic web context\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "orders.md"),
    "# Orders\nMarker: DOMAIN-SANDBOX-MARKER\n- Settlement flows must preserve payment workflow invariants.\n- Keep release and reverse amounts aligned with the workflow state.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-DISTRACTOR-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "balance.md"), "# Balance\nBALANCE-DISTRACTOR-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "batch.md"), "# Batch\nBATCH-DUAL-MARKER\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "domain", "subagent.md"),
    "# Subagent\nDOMAIN-SUBAGENT-MARKER\n- This task is in the payment settlement workflow.\n- The relevant domain doc is the payment settlement context, not generic web docs.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "web.md"), "# Web\nDOMAIN-WEB-DISTRACTOR-MARKER\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      goal: "Update payment settlement controller.",
      action: "Update the payment settlement workflow controller and keep transport logic thin.",
      verification: "Run the focused controller test.",
      done: "Controller delegates to the payment settlement service with no business logic.",
      contextReference: "`CONTEXT.md#payment-settlement` — Preserve payment settlement workflow.",
    }),
    "utf-8"
  )
  writeFileSync(path.join(root, ".opencode", "state", "persistent-context.md"), "MEMORY-SANDBOX-MARKER\n", "utf-8")
  writeFileSync(
    path.join(root, ".opencode", "state", "active-plan.json"),
    JSON.stringify(
      {
        slug: "feature-x",
        planPath: "docs/specs/feature-x/plan.md",
        specPath: "docs/specs/feature-x/spec.md",
        contextPath: "docs/specs/feature-x/CONTEXT.md",
      },
      null,
      2
    ) + "\n",
    "utf-8"
  )
  writeFileSync(path.join(root, ".opencode", "state", "execution-state.md"), "**Goal**: update payment controller\n- [ ] task: update payment endpoint\n", "utf-8")

  writeFileSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "configuration", "HeaderNames.kt"), "package br.com.olx.trp.financial.web.configuration\nconst val REQUEST_ID_HEADER = \"X-Request-Id\"\n", "utf-8")
  writeFileSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "service", "SampleService.kt"), "package br.com.olx.trp.financial.domain.service\nclass SampleService {\n  fun create(requestId: String, request: Any): String = requestId\n}\n", "utf-8")
  writeFileSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample", "request", "CreateSampleRequest.kt"), "package br.com.olx.trp.financial.web.controller.sample.request\nimport jakarta.validation.constraints.NotBlank\n\ndata class CreateSampleRequest(@field:NotBlank val name: String)\n", "utf-8")
  writeFileSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample", "SampleController.kt"), "package br.com.olx.trp.financial.web.controller.sample\n\nclass SampleController\n", "utf-8")

  writeFileSync(path.join(root, "package-lock.json"), '{"name":"sandbox","lockfileVersion":3,"requires":true,"packages":{}}\n', "utf-8")
  writeFileSync(path.join(root, "README.md"), "sandbox\n", "utf-8")
  writeFileSync(path.join(root, "RUNBOOK.md"), "Run focused tests with ./mvnw test -Dtest=ClassName\n", "utf-8")

  const mvnwLog = path.join(root, ".mvnw.log")
  writeExecutable(
    path.join(root, "mvnw"),
    `#!/bin/sh
set -e
printf '%s\n' "$*" >> "${mvnwLog}"
if echo "$*" | grep -q 'spotless:check'; then
  if [ -f src/main/kotlin/br/com/olx/trp/financial/BadService.kt ] && grep -q 'TODO remove before commit' src/main/kotlin/br/com/olx/trp/financial/BadService.kt; then
    echo 'spotless failed: TODO comments are not allowed in BadService.kt' >&2
    exit 1
  fi
  exit 0
fi
if echo "$*" | grep -q -- '-DskipTests compile test-compile'; then
  exit 0
fi
if echo "$*" | grep -q '^test\\| test '; then
  if [ -f src/main/kotlin/br/com/olx/trp/financial/BadService.kt ] && grep -q 'TODO remove before commit' src/main/kotlin/br/com/olx/trp/financial/BadService.kt; then
    echo 'tests should not run before lint is fixed' >&2
    exit 1
  fi
  exit 0
fi
exit 0
`
  )

  writeFileSync(path.join(root, "Makefile"), "lint:\n\t./mvnw spotless:check\n", "utf-8")
  spawnSync("git", ["init"], { cwd: root, stdio: "inherit" })
  spawnSync("git", ["config", "user.name", "Harness Eval"], { cwd: root, stdio: "inherit" })
  spawnSync("git", ["config", "user.email", "harness-eval@example.com"], { cwd: root, stdio: "inherit" })
  spawnSync("sh", [".opencode/scripts/install-git-hooks.sh"], { cwd: root, stdio: "inherit" })
}

function seedDualDomainSandboxVariant(root: string) {
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "API_STATE=active",
      "API_RECALL=controller",
      "API_FILE=docs/principles/api-patterns.md",
      "API_PRIORITY=1",
      "API_ALWAYS=true",
      "CASHOUT_STATE=active",
      "CASHOUT_RECALL=cashout,payout,transfer,batch,scheduled,processing",
      "CASHOUT_FILE=docs/principles/subagent-patterns.md",
      "CASHOUT_PRIORITY=2",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "subagent-patterns.md"),
    "# Cashout Batch Patterns\nPRINCIPLE-SUBAGENT-MARKER\n- For cashout batch-processing tasks, treat transfer rules and batch scheduling as a single workflow boundary.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Cashout\nKeywords: cashout, payout, transfer, processing, scheduled send\nFiles:\n- cashout.md — Cashout workflow\n\n## Batch\nKeywords: batch, processing, transfer batch, scheduled send, batch assignment\nFiles:\n- batch.md — Batch scheduling\n\n## Bank-account\nKeywords: bank account, favorite account, payout account\nFiles:\n- bank-account.md — Bank account rules\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "cashout.md"),
    "# Cashout\nCASHOUT-DUAL-MARKER\n- Cashout transfer keeps payout workflow and provider handoff rules consistent.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "batch.md"),
    "# Batch\nBATCH-DUAL-MARKER\n- Batch processing keeps scheduled-send grouping and batch assignment rules aligned.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "bank-account.md"), "# Bank Account\nBANK-ACCOUNT-DISTRACTOR\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      goal: "Update cashout batch processing.",
      action: "Update the cashout batch processing flow so scheduled send retries keep transfer and batch assignment behavior consistent.",
      verification: "Run the focused cashout batch processing test.",
      done: "Cashout processing keeps both payout transfer rules and batch scheduling behavior aligned.",
      contextReference: "`CONTEXT.md#cashout-batch-processing` — Preserve transfer and batch scheduling rules.",
    }),
    "utf-8"
  )
  writeFileSync(path.join(root, ".opencode", "state", "execution-state.md"), "**Goal**: update cashout batch processing\n- [ ] task: update cashout transfer and batch behavior\n", "utf-8")
}

function seedMixedDomainSandboxVariant(root: string) {
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "API_STATE=active",
      "API_RECALL=controller",
      "API_FILE=docs/principles/api-patterns.md",
      "API_PRIORITY=1",
      "API_ALWAYS=true",
      "ASYNC_STATE=active",
      "ASYNC_RECALL=listener,event,queue,topic,replay",
      "ASYNC_FILE=docs/principles/subagent-patterns.md",
      "ASYNC_PRIORITY=2",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "subagent-patterns.md"),
    "# Async Messaging Patterns\nPRINCIPLE-SUBAGENT-MARKER\n- Keep listeners thin and preserve workflow state transitions.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Orders\nKeywords: order, release, reverse, settlement workflow\nFiles:\n- orders.md — Order workflow\n\n## Messaging\nKeywords: event, queue, topic, listener, sns, sqs\nFiles:\n- messaging.md — Messaging contracts\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "orders.md"),
    "# Orders\nMarker: DOMAIN-SANDBOX-MARKER\n- Order workflow changes must preserve settlement and release state transitions.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "messaging.md"), "# Messaging\nMESSAGING-DISTRACTOR-MARKER\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      goal: "Update order settlement listener.",
      action: "Update the order settlement workflow listener handling so replayed events preserve the correct state transitions.",
      verification: "Run the focused order listener test.",
      done: "Order workflow transitions remain correct and the listener stays thin.",
      contextReference: "`CONTEXT.md#order-settlement-listener` — Preserve replay state transitions.",
    }),
    "utf-8"
  )
  writeFileSync(path.join(root, ".opencode", "state", "execution-state.md"), "**Goal**: update order listener workflow\n- [ ] task: update order workflow event handling\n", "utf-8")
}

function seedCashoutBalanceSandboxVariant(root: string) {
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "API_STATE=active",
      "API_RECALL=controller",
      "API_FILE=docs/principles/api-patterns.md",
      "API_PRIORITY=1",
      "API_ALWAYS=true",
      "CASHOUT_STATE=active",
      "CASHOUT_RECALL=cashout,payout,transfer,approval,balance,debit,credit",
      "CASHOUT_FILE=docs/principles/subagent-patterns.md",
      "CASHOUT_PRIORITY=2",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "subagent-patterns.md"),
    "# Cashout Balance Patterns\nPRINCIPLE-SUBAGENT-MARKER\n- Cashout approval changes must keep workflow status and balance mutations aligned.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Cashout\nKeywords: cashout, payout, transfer, withdrawal, cashout approval\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, available, escrow, debit, credit\nFiles:\n- balance.md — Balance movements\n\n## Batch\nKeywords: batch, transfer batch, scheduled send, batch zero\nFiles:\n- batch.md — Batch scheduling\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "cashout.md"),
    "# Cashout\nCASHOUT-BALANCE-CASHOUT-MARKER\n- Cashout approval keeps payout workflow and provider completion rules consistent.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "balance.md"),
    "# Balance\nCASHOUT-BALANCE-BALANCE-MARKER\n- Balance mutations must keep AVAILABLE, CASHOUT, and undo flows consistent.\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "batch.md"), "# Batch\nCASHOUT-BALANCE-BATCH-DISTRACTOR\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      goal: "Update cashout approval balance flow.",
      action: "Update the cashout approval flow so balance debits and cashout state changes stay consistent.",
      verification: "Run the focused cashout conclusion test.",
      done: "Cashout approval preserves both cashout workflow and balance mutation rules.",
      contextReference: "`CONTEXT.md#cashout-approval-balance` — Preserve cashout and balance rules.",
    }),
    "utf-8"
  )
  writeFileSync(path.join(root, ".opencode", "state", "execution-state.md"), "**Goal**: update cashout approval balance flow\n- [ ] task: update cashout and balance behavior\n", "utf-8")
}

function seedImplementCommandSandboxVariant(root: string) {
  mkdirSync(path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial"), { recursive: true })
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "spec.md"),
    [
      "# FooService Spec",
      "",
      "## Acceptance Criteria",
      "- Create `src/main/kotlin/br/com/olx/trp/financial/FooService.kt`.",
      "- Declare `class FooService` in that file.",
      "- Keep the implementation minimal.",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      goal: "Create FooService via the harness implementation loop.",
      name: "Create FooService",
      files: ["src/main/kotlin/br/com/olx/trp/financial/FooService.kt"],
      action: "Create the smallest production Kotlin file that declares class FooService.",
      verification: "Confirm the file exists and declares class FooService.",
      done: "The file exists at the planned path and declares class FooService.",
      contextReference: "`CONTEXT.md#foo-service` — Create only the planned FooService file.",
    }),
    "utf-8"
  )
  writeFileSync(
    path.join(root, ".opencode", "state", "execution-state.md"),
    [
      "# Execution State",
      "",
      "- **Goal**: create FooService through /j.implement",
      "- **Plan**: docs/specs/feature-x/plan.md",
      "- **Feature slug**: feature-x",
      "",
      "## Incomplete Tasks",
      "- [ ] Task 1 — Create FooService",
      "",
    ].join("\n"),
    "utf-8"
  )
}

function seedCheckCommandSandboxVariant(root: string) {
  seedImplementCommandSandboxVariant(root)
  mkdirSync(path.join(root, "docs", "specs", "feature-x", "state", "tasks", "task-1"), { recursive: true })
  writeFileSync(
    path.join(root, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "FooService.kt"),
    "package br.com.olx.trp.financial\n\nclass FooService\n",
    "utf-8"
  )
  spawnSync("git", ["switch", "-c", "feature/feature-x"], { cwd: root, stdio: "ignore" })
  spawnSync("git", ["add", "."], { cwd: root, stdio: "ignore" })
  spawnSync("git", ["commit", "-m", "feat(financial): seed reviewable task"], { cwd: root, stdio: "ignore" })

  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "tasks", "task-1", "execution-state.md"),
    [
      "# Task 1 — Execution State",
      "",
      "- **Status**: COMPLETE",
      "- **Feature slug**: feature-x",
      "- **Wave**: 1",
      "- **Attempt**: 1",
      "- **Branch**: feature/feature-x",
      "- **Started at**: 2026-04-10T00:00:00Z",
      "- **Last heartbeat**: 2026-04-11T00:08:03Z",
      "- **Depends on**: None",
      "- **Retry of**: None",
      `- **Validated commit**: ${spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim()}`,
      "",
      "## Files Modified",
      "- src/main/kotlin/br/com/olx/trp/financial/FooService.kt",
      "",
      "## Validation Verdict",
      "APPROVED.",
      "",
      "## Failure Details (if FAILED/BLOCKED)",
      "None.",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "tasks", "task-1", "validator-work.md"),
    "# Validator Work Log — Task 1 — 2026-04-11\n\n## Verdict: APPROVED\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "integration-state.json"),
    JSON.stringify(
      {
        featureSlug: "feature-x",
        featureBranch: "feature/feature-x",
        baseBranch: "main",
        baseRef: "refs/remotes/origin/main",
        baseStartPoint: "seed",
        createdAt: "2026-04-10T00:00:00Z",
        lastUpdatedAt: "2026-04-11T00:08:17.897Z",
        tasks: {
          "1": {
            taskID: "1",
            planBranch: "feature/feature-x",
            taskBranch: "feature/feature-x",
            validatedCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim(),
            taskTip: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim(),
            attempt: 1,
            taskLabel: "Create FooService",
            recordedAt: "2026-04-11T00:08:17.624Z",
            integration: {
              status: "direct",
              method: "direct-commit",
              featureBranch: "feature/feature-x",
              taskBranch: "feature/feature-x",
              integratedAt: "2026-04-11T00:08:17.896Z",
              integratedCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).stdout.trim(),
            },
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf-8"
  )

  writeExecutable(
    path.join(root, ".opencode", "scripts", "check-all.sh"),
    `#!/bin/sh
set -e
mkdir -p docs/specs/feature-x/state
OUTPUT="docs/specs/feature-x/state/check-all-output.txt"
{
  echo "[juninho:check-all] Command: sh .opencode/scripts/check-all.sh"
  echo "[juninho:check-all] Running on branch: $(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  echo "[juninho:check-all] Running formatting checks..."
  echo "[juninho:check-all] Running build verification..."
  echo "[juninho:check-all] Running repo-wide tests..."
  echo "[juninho:check-all] Result: PASS"
  echo "[juninho:check-all] Exit code: 0"
} | tee "$OUTPUT"
exit 0
`
  )
}

function seedUnifyCommandSandboxVariant(root: string) {
  seedCheckCommandSandboxVariant(root)
  mkdirSync(path.join(root, ".opencode", "state"), { recursive: true })
  writeFileSync(
    path.join(root, ".opencode", "state", "persistent-context.md"),
    "# Persistent Context\n\n## Decisions\n- Existing long-term decision.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, ".opencode", "state", "execution-state.md"),
    [
      "# Execution State",
      "",
      "- **Goal**: unify feature-x",
      "- **Plan**: docs/specs/feature-x/plan.md",
      "- **Feature slug**: feature-x",
      "",
      "## In Progress",
      "- [ ] stale item to clear",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "functional-validation-plan.md"),
    "# Functional Validation Plan\n\n## Scope\n- FooService feature\n\n## Functional Scenarios\n1. Confirm FooService exists.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "check-review.md"),
    "# Code Review\n\n## Findings\n\n### Critical (fix before shipping)\n- None.\n\n### Important (fix soon)\n- None.\n\n### Minor (consider for next iteration)\n- None.\n\n## Overall: LGTM\n",
    "utf-8"
  )
}

function seedCheckerStartupSandboxVariant(root: string) {
  seedCheckCommandSandboxVariant(root)
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "CHECK_STATE=active",
      "CHECK_RECALL=review,settlement,order,balance,quality,validation",
      "CHECK_FILE=docs/principles/checker-patterns.md",
      "CHECK_PRIORITY=1",
      "CHECK_ALWAYS=true",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "checker-patterns.md"),
    "# Checker Patterns\nCHECKER-PRINCIPLE-MARKER\n- Full checks must use persisted validation artifacts and preserve financial workflow risk review.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Orders\nKeywords: order, settlement, review, quality gate\nFiles:\n- orders.md — Order workflow\n\n## Balance\nKeywords: balance, available, review, validation\nFiles:\n- balance.md — Balance safeguards\n\n## Cashout\nKeywords: cashout, payout, withdrawal\nFiles:\n- cashout.md — Cashout workflow\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "orders.md"), "# Orders\nCHECKER-ORDERS-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "balance.md"), "# Balance\nCHECKER-BALANCE-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "cashout.md"), "# Cashout\nCHECKER-CASHOUT-DISTRACTOR\n", "utf-8")
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "spec.md"),
    "# Spec\n\nReview the order settlement path and confirm balance safety.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "CONTEXT.md"),
    "# Context\n\nThe feature changes order settlement review flow and balance validation coverage.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "specs", "feature-x", "state", "functional-validation-plan.md"),
    "# Functional Validation Plan\n\nValidate order settlement and available balance behavior before shipping.\n",
    "utf-8"
  )
}

function seedPlannerStartupSandboxVariant(root: string) {
  seedHarnessSandbox(root)
  writeFileSync(
    path.join(root, ".opencode", "juninho-config.json"),
    JSON.stringify(
      {
        strong: "github-copilot/gpt-5.5",
        medium: "github-copilot/gpt-5.5",
        weak: "github-copilot/claude-haiku-4.5",
        projectType: "java",
        isKotlin: true,
        buildTool: "maven",
        workflow: {
          automation: {
            nonInteractive: true,
            autoApproveArtifacts: true,
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "PLAN_STATE=active",
      "PLAN_RECALL=plan,order,settlement,balance,feature",
      "PLAN_FILE=docs/principles/planner-patterns.md",
      "PLAN_PRIORITY=1",
      "PLAN_ALWAYS=true",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "planner-patterns.md"),
    "# Planner Patterns\nPLANNER-PRINCIPLE-MARKER\n- Plans for financial workflows must preserve state invariants and validation coverage.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Orders\nKeywords: order, settlement, release, feature\nFiles:\n- orders.md — Order workflow\n\n## Balance\nKeywords: balance, available, debit, credit\nFiles:\n- balance.md — Balance safeguards\n\n## Cashout\nKeywords: cashout, payout, withdrawal\nFiles:\n- cashout.md — Cashout workflow\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "orders.md"), "# Orders\nPLANNER-ORDERS-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "balance.md"), "# Balance\nPLANNER-BALANCE-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "cashout.md"), "# Cashout\nPLANNER-CASHOUT-DISTRACTOR\n", "utf-8")
}

function seedSpecStartupSandboxVariant(root: string) {
  seedHarnessSandbox(root)
  writeFileSync(
    path.join(root, ".opencode", "juninho-config.json"),
    JSON.stringify(
      {
        strong: "github-copilot/gpt-5.5",
        medium: "github-copilot/gpt-5.5",
        weak: "github-copilot/claude-haiku-4.5",
        projectType: "java",
        isKotlin: true,
        buildTool: "maven",
        workflow: {
          automation: {
            nonInteractive: true,
            autoApproveArtifacts: true,
          },
        },
      },
      null,
      2
    ) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "manifest"),
    [
      "SPEC_STATE=active",
      "SPEC_RECALL=cashout,approval,balance,escrow,spec",
      "SPEC_FILE=docs/principles/spec-patterns.md",
      "SPEC_PRIORITY=1",
      "SPEC_ALWAYS=true",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "principles", "spec-patterns.md"),
    "# Spec Patterns\nSPEC-PRINCIPLE-MARKER\n- Specs for cashout approval must preserve workflow and balance contracts.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(root, "docs", "domain", "INDEX.md"),
    "## Cashout\nKeywords: cashout, approval, payout, transfer\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, available, escrow, debit, credit\nFiles:\n- balance.md — Balance safeguards\n\n## Web\nKeywords: controller, request, response\nFiles:\n- web.md — Generic web behavior\n",
    "utf-8"
  )
  writeFileSync(path.join(root, "docs", "domain", "cashout.md"), "# Cashout\nSPEC-CASHOUT-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "balance.md"), "# Balance\nSPEC-BALANCE-MARKER\n", "utf-8")
  writeFileSync(path.join(root, "docs", "domain", "web.md"), "# Web\nSPEC-WEB-DISTRACTOR\n", "utf-8")
}

const SANDBOX_VARIANT_SEEDERS: Record<number, (root: string) => void> = {
  10: seedMixedDomainSandboxVariant,
  11: seedDualDomainSandboxVariant,
  12: seedCashoutBalanceSandboxVariant,
  13: seedImplementCommandSandboxVariant,
  14: seedCheckCommandSandboxVariant,
  15: seedUnifyCommandSandboxVariant,
  16: seedCheckerStartupSandboxVariant,
  17: seedPlannerStartupSandboxVariant,
  18: seedSpecStartupSandboxVariant,
}

function seedHarnessSandboxForTask(root: string, index: number) {
  seedHarnessSandbox(root)
  SANDBOX_VARIANT_SEEDERS[index]?.(root)
}

function runOpencodeEval(task: EvalTask, sandboxPath: string): EvalResult {
  const transcriptPath = path.join(sandboxPath, "eval-output.jsonl")
  const startedAt = performance.now()
  const result = spawnSync("opencode", ["run", "--dir", sandboxPath, "--format", "json", "--", task.question], {
    cwd: sandboxPath,
    encoding: "utf-8",
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  })
  const totalDurationMs = performance.now() - startedAt
  writeFileSync(transcriptPath, result.stdout ?? "", "utf-8")

  const events = parseEvents(transcriptPath)
  const toolMetrics = collectToolMetrics(events)
  const totalToolCalls = Object.values(toolMetrics).reduce((sum, metric) => sum + metric.count, 0)
  const textParts = collectTextParts(events)
  const actualAnswer = textParts.join("\n\n").trim()
  const orchestratorFeedback = textParts.slice(0, -1).join("\n\n").trim()
  const sessionID = collectSessionID(events)
  const preferredToolUsed = task.preferredTool ? Boolean(toolMetrics[task.preferredTool]) : true
  const exactPreferredToolMatch = task.preferredTool ? Boolean(toolMetrics[task.preferredTool]) : true

  return {
    question: task.question,
    preferredTool: task.preferredTool,
    expectedAnswer: task.answer,
    actualAnswer,
    orchestratorFeedback,
    toolMetrics,
    totalDurationMs,
    totalToolCalls,
    preferredToolUsed,
    withinToolBudget: typeof task.maxToolCalls === "number" ? totalToolCalls <= task.maxToolCalls : null,
    withinDurationBudget: typeof task.maxDurationMs === "number" ? totalDurationMs <= task.maxDurationMs : null,
    exactPreferredToolMatch,
    exactAnswerMatch: exactAnswerMatch(task, actualAnswer),
    sessionID,
    transcriptPath,
    sandboxPath,
    taskError: result.status === 0 ? undefined : (result.stderr || "opencode run failed").trim(),
  }
}

function compareControllerWithAndWithoutSkill(): string | null {
  const sourceRepo = path.resolve(currentDir, "../../..")
  const prompt = "First use the read tool on `src/main/kotlin/br/com/olx/trp/financial/web/controller/sample/SampleController.kt` so any controller guidance can trigger. Then create that file using existing repository conventions. When finished, answer exactly `controller-guidance=used` only if you reused `REQUEST_ID_HEADER`, delegated to `SampleService`, and kept business logic out of the controller."

  const runVariant = (withSkill: boolean) => {
    const sandbox = mktemp(withSkill ? "juninho-controller-skill-" : "juninho-controller-baseline-")
    seedHarnessSandbox(sandbox)
    if (!withSkill) {
      const mapPath = path.join(sandbox, ".opencode", "skill-map.json")
      const data = JSON.parse(readFileSync(mapPath, "utf-8")) as Array<{ pattern: string; skill: string }>
      writeFileSync(mapPath, JSON.stringify(data.filter((entry) => entry.skill !== "j.controller-writing"), null, 2) + "\n", "utf-8")
      rmSync(path.join(sandbox, ".opencode", "skills", "j.controller-writing"), { recursive: true, force: true })
    }
    const result = runOpencodeEval({ question: prompt, answer: "controller-guidance=used" }, sandbox)
    const controllerPath = path.join(sandbox, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample", "SampleController.kt")
    const controller = existsSync(controllerPath) ? readFileSync(controllerPath, "utf-8") : ""
    const skillMarker = extractControllerSkillMarker(sandbox)
    return { result, controller, sandbox, skillMarker }
  }

  const withSkill = runVariant(true)
  const withoutSkill = runVariant(false)
  const withUsesHeader = withSkill.controller.includes("REQUEST_ID_HEADER")
  const withDelegates = withSkill.controller.includes("SampleService")
  const withSkillMarker = withSkill.skillMarker ? withSkill.controller.includes(withSkill.skillMarker) : false
  const withoutSkillMarker = withSkill.skillMarker ? withoutSkill.controller.includes(withSkill.skillMarker) : false

  rmSync(withSkill.sandbox, { recursive: true, force: true })
  rmSync(withoutSkill.sandbox, { recursive: true, force: true })

  if (!withUsesHeader || !withDelegates || !withSkillMarker) {
    return "controller skill variant did not apply expected skill-specific conventions"
  }
  if (withoutSkillMarker) return "baseline unexpectedly matched skill-specific marker"
  return null
}

function compareMapperWithAndWithoutSkill(): string | null {
  const prompt = "First use the read tool on `src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/SampleAggregateMapper.kt` so any mapper guidance can trigger. Then create that file using existing repository conventions. When finished, answer exactly `mapper-guidance=used` only if you chose a manual Function or BiFunction mapper, avoided extension mapping functions, and kept business logic out of the mapper."

  const runVariant = (withSkill: boolean) => {
    const sandbox = mktemp(withSkill ? "juninho-mapper-skill-" : "juninho-mapper-baseline-")
    seedHarnessSandbox(sandbox)
    if (!withSkill) {
      const mapPath = path.join(sandbox, ".opencode", "skill-map.json")
      const data = JSON.parse(readFileSync(mapPath, "utf-8")) as Array<{ pattern: string; skill: string }>
      writeFileSync(mapPath, JSON.stringify(data.filter((entry) => entry.skill !== "j.mapper-writing"), null, 2) + "\n", "utf-8")
      rmSync(path.join(sandbox, ".opencode", "skills", "j.mapper-writing"), { recursive: true, force: true })
    }
    const result = runOpencodeEval({ question: prompt, answer: "mapper-guidance=used" }, sandbox)
    const mapperPath = path.join(sandbox, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper", "SampleAggregateMapper.kt")
    const mapper = existsSync(mapperPath) ? readFileSync(mapperPath, "utf-8") : ""
    const skillMarker = extractMapperSkillMarker(sandbox)
    return { result, mapper, sandbox, skillMarker }
  }

  const withSkill = runVariant(true)
  const withoutSkill = runVariant(false)
  const withManualMapper = withSkill.mapper.includes("Function<") || withSkill.mapper.includes("BiFunction<")
  const withNoExtension = !/fun\s+\w+\.to[A-Z]/.test(withSkill.mapper)
  const withSkillMarker = withSkill.skillMarker ? withSkill.mapper.includes(withSkill.skillMarker) : false
  const withoutSkillMarker = withSkill.skillMarker ? withoutSkill.mapper.includes(withSkill.skillMarker) : false

  rmSync(withSkill.sandbox, { recursive: true, force: true })
  rmSync(withoutSkill.sandbox, { recursive: true, force: true })

  if (!withManualMapper || !withNoExtension || !withSkillMarker) {
    return "mapper skill variant did not apply expected skill-specific conventions"
  }
  if (withoutSkillMarker) return "baseline unexpectedly matched skill-specific mapper marker"
  return null
}

function postCheck(result: EvalResult, index: number): string | null {
  const events = parseEvents(result.transcriptPath)

  if (index === 0) {
    if (!result.toolMetrics.read || result.toolMetrics.read.count < 1) return "expected read tool usage"
    if (!result.toolMetrics.skill || result.toolMetrics.skill.count < 1) return "expected controller skill loading"
    return result.actualAnswer.includes("markers:") ? null : "missing expected marker summary"
  }

  if (index === 1) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    const outputs = collectToolOutputs(events, "task")
    if (!outputs.some((output) => output.includes("PRINCIPLE-SUBAGENT-MARKER") && output.includes("DOMAIN-SUBAGENT-MARKER"))) {
      return "subagent output did not include expected domain/principle markers"
    }
    return result.actualAnswer.includes("subagent-markers:") ? null : "missing subagent marker summary"
  }

  if (index === 2) {
    if (!result.toolMetrics.read || result.toolMetrics.read.count < 1) return "expected read tool usage"
    return result.actualAnswer.includes("markers:") ? null : "missing expected marker summary"
  }

  if (index === 3) {
    if (!result.toolMetrics["find-pattern_find_pattern"] || result.toolMetrics["find-pattern_find_pattern"].count < 1) return "expected find_pattern tool usage"
    return result.actualAnswer.includes("tool=find_pattern") ? null : "find_pattern did not succeed"
  }

  if (index === 4) {
    if (!result.toolMetrics["next-version_next_version"] || result.toolMetrics["next-version_next_version"].count < 1) return "expected next_version tool usage"
    return result.actualAnswer.includes("tool=next_version:0002") ? null : "next_version did not return expected value"
  }

  if (index === 5) {
    if (!result.toolMetrics["lsp_lsp_document_symbols"] || result.toolMetrics["lsp_lsp_document_symbols"].count < 1) return "expected lsp_document_symbols tool usage"
    return result.actualAnswer.includes("tool=lsp_document_symbols:Foo,bar") ? null : "lsp_document_symbols did not return expected symbols"
  }

  const gitLog = spawnSync("git", ["log", "--oneline", "-1"], {
    cwd: result.sandboxPath,
    encoding: "utf-8",
  })
  const logText = gitLog.stdout.trim()

  if (index === 6) {
    if (!result.toolMetrics.bash || result.toolMetrics.bash.count < 1) return "expected bash tool usage for commit flow"
    if (!logText.includes("test: hook success")) return "missing successful commit after hook"
    return null
  }

  if (index === 7) {
    if (!result.toolMetrics.bash || result.toolMetrics.bash.count < 1) return "expected bash tool usage for hook recovery"
    const mvnwLog = existsSync(path.join(result.sandboxPath, ".mvnw.log"))
      ? readFileSync(path.join(result.sandboxPath, ".mvnw.log"), "utf-8")
      : ""
    if (!logText.includes("test: hook recovery")) return "missing recovery commit after hook failure"
    if (!mvnwLog.includes("spotless:check")) return "hook lint did not run"
    if ((mvnwLog.match(/spotless:check/g) ?? []).length < 2) return "hook recovery did not retry lint"
    return null
  }

  if (index === 8) {
    const controllerPath = path.join(result.sandboxPath, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "web", "controller", "sample", "SampleController.kt")
    if (!existsSync(controllerPath)) return "controller file was not created"
    const controller = readFileSync(controllerPath, "utf-8")
    const skillMarker = extractControllerSkillMarker(result.sandboxPath)
    if (!controller.includes("REQUEST_ID_HEADER")) return "controller did not reuse REQUEST_ID_HEADER"
    if (!controller.includes("SampleService")) return "controller did not delegate to SampleService"
    if (!skillMarker || !controller.includes(skillMarker)) return "controller did not apply skill-specific marker"
    if (!result.toolMetrics.skill || result.toolMetrics.skill.count < 1) return "expected controller skill usage"
    const comparison = compareControllerWithAndWithoutSkill()
    if (comparison) return comparison
    return result.actualAnswer.includes("controller-guidance=used") ? null : "controller guidance outcome missing"
  }

  if (index === 9) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("startup-context=ready")) return "startup context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export child session transcript"
    const child = childSessions[0]
    const systems = childSystemPrompts(child)
    if (!hasStartupContextLabel(systems)) {
      return "child session did not receive CARL startup context"
    }
    if (!systems.some((system) => system.includes("PRINCIPLE-SUBAGENT-MARKER") && system.includes("DOMAIN-SUBAGENT-MARKER"))) {
      return "child startup context did not include expected principle/domain markers"
    }
    if (systems.some((system) => system.includes("TEST-DISTRACTOR-MARKER"))) {
      return "child startup context included irrelevant test principle distractor"
    }
    if (systems.some((system) => system.includes("DOMAIN-WEB-DISTRACTOR-MARKER"))) {
      return "child startup context included irrelevant web domain distractor"
    }
    if (systems.some((system) => system.includes("CASHOUT-DISTRACTOR-MARKER"))) {
      return "child startup context included irrelevant cashout domain distractor"
    }
    if (systems.some((system) => system.includes("BALANCE-DISTRACTOR-MARKER"))) {
      return "child startup context included irrelevant balance domain distractor"
    }

    const tools = childToolSequence(child)
    const firstReadIndex = tools.findIndex((tool) => tool === "read")
    const firstGlobIndex = tools.findIndex((tool) => tool === "glob")
    const firstGrepIndex = tools.findIndex((tool) => tool === "grep")
    if (firstGlobIndex !== -1 && (firstReadIndex === -1 || firstGlobIndex < firstReadIndex)) {
      return "child explored with glob before first targeted read"
    }
    if (firstGrepIndex !== -1 && (firstReadIndex === -1 || firstGrepIndex < firstReadIndex)) {
      return "child explored with grep before first targeted read"
    }

    const readTargets = childReadTargets(child)
    if (readTargets.some((target) => /README\.md$|RUNBOOK\.md$/i.test(target))) {
      return "child still read README or RUNBOOK despite startup context"
    }

    return null
  }

  if (index === 10) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("mixed-domain-context=ready")) return "mixed domain context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export child session transcript"
    const child = childSessions[0]
    const systems = childSystemPrompts(child)
    if (!hasStartupContextLabel(systems)) {
      return "child session did not receive CARL startup context"
    }
    if (!systems.some((system) => system.includes("Marker: DOMAIN-SANDBOX-MARKER"))) {
      return "child startup context did not include order workflow domain guidance"
    }
    if (!systems.some((system) => system.includes("PRINCIPLE-SUBAGENT-MARKER"))) {
      return "child startup context did not include async principle guidance"
    }
    if (systems.some((system) => system.includes("MESSAGING-DISTRACTOR-MARKER"))) {
      return "child startup context included irrelevant messaging domain distractor"
    }

    return null
  }

  if (index === 11) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("dual-domain-context=ready")) return "dual domain context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export child session transcript"
    const child = childSessions[0]
    const systems = childSystemPrompts(child)
    if (!systems.some((system) => system.includes("CASHOUT-DUAL-MARKER"))) {
      return "child startup context did not include cashout domain guidance"
    }
    if (!systems.some((system) => system.includes("BATCH-DUAL-MARKER"))) {
      return "child startup context did not include batch domain guidance"
    }
    if (systems.some((system) => system.includes("BANK-ACCOUNT-DISTRACTOR"))) {
      return "child startup context included irrelevant bank-account distractor"
    }

    return null
  }

  if (index === 12) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("cashout-balance-context=ready")) return "cashout balance context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export child session transcript"
    const child = childSessions[0]
    const systems = childSystemPrompts(child)
    if (!systems.some((system) => system.includes("CASHOUT-BALANCE-CASHOUT-MARKER"))) {
      return "child startup context did not include cashout workflow guidance"
    }
    if (!systems.some((system) => system.includes("CASHOUT-BALANCE-BALANCE-MARKER"))) {
      return "child startup context did not include balance guidance"
    }
    if (systems.some((system) => system.includes("CASHOUT-BALANCE-BATCH-DISTRACTOR"))) {
      return "child startup context included irrelevant batch distractor"
    }

    return null
  }

  if (index === 13) {
    if (!result.actualAnswer.includes("implement-loop=ready")) return "implement loop outcome missing"

    const fooServicePath = path.join(result.sandboxPath, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "FooService.kt")
    if (!existsSync(fooServicePath)) return "implement loop did not create FooService"
    const fooService = readFileSync(fooServicePath, "utf-8")
    if (!fooService.includes("class FooService")) return "FooService file missing class declaration"

    const gitBranch = spawnSync("git", ["branch", "--show-current"], {
      cwd: result.sandboxPath,
      encoding: "utf-8",
    }).stdout.trim()
    if (gitBranch !== "feature/feature-x") return "implement loop did not finish on canonical feature branch"

    const gitLog = spawnSync("git", ["log", "--oneline", "-1"], {
      cwd: result.sandboxPath,
      encoding: "utf-8",
    }).stdout.trim()
    if (!gitLog) return "implement loop did not produce a commit"

    const validatorPath = path.join(result.sandboxPath, "docs", "specs", "feature-x", "state", "tasks", "task-1", "validator-work.md")
    if (!existsSync(validatorPath)) return "implement loop did not write validator output"
    const validatorLog = readFileSync(validatorPath, "utf-8")
    if (!/## Verdict: APPROVED|## Verdict: APPROVED_WITH_NOTES/.test(validatorLog)) {
      return "validator output did not approve the task"
    }

    const integrationPath = path.join(result.sandboxPath, "docs", "specs", "feature-x", "state", "integration-state.json")
    if (!existsSync(integrationPath)) return "implement loop did not write integration manifest"
    const integration = JSON.parse(readFileSync(integrationPath, "utf-8")) as any
    const taskEntry = integration?.tasks?.["1"]
    if (!taskEntry?.validatedCommit) return "integration manifest missing validated commit for task 1"
    if (taskEntry?.integration?.status !== "direct") return "integration manifest did not record direct task integration"

    const descendants = exportDescendantSessions(parseEvents(result.transcriptPath))
    const agents = descendants.map((session) => exportedSessionAgent(session)).filter(Boolean)
    if (!agents.includes("j.implementer")) return "implement command did not delegate to j.implementer"
    if (!agents.includes("j.validator")) return "implement loop did not invoke j.validator"

    return null
  }

  if (index === 14) {
    if (!result.actualAnswer.includes("check-loop=ready")) return "check loop outcome missing"

    const reviewPath = path.join(result.sandboxPath, "docs", "specs", "feature-x", "state", "check-review.md")
    if (!existsSync(reviewPath)) return "check loop did not write check-review.md"
    const review = readFileSync(reviewPath, "utf-8")
    if (!/# Code Review/i.test(review)) return "check review report missing expected heading"
    if (!/##\s+Findings/i.test(review)) return "check review report missing findings section"
    if (!/##\s+Reentry Contract/i.test(review)) return "check review report missing reentry contract"
    if (!/##\s+Overall[:\s]/i.test(review)) return "check review report missing overall verdict"

    const descendants = exportDescendantSessions(parseEvents(result.transcriptPath))
    const agents = descendants.map((session) => exportedSessionAgent(session)).filter(Boolean)
    if (!agents.includes("j.checker")) return "check loop did not invoke j.checker"
    if (!agents.includes("j.reviewer")) return "check loop did not invoke j.reviewer"

    const checkAllOutputPath = path.join(result.sandboxPath, "docs", "specs", "feature-x", "state", "check-all-output.txt")
    if (!existsSync(checkAllOutputPath)) return "check loop did not persist check-all output"
    const checkAllOutput = readFileSync(checkAllOutputPath, "utf-8")
    const ranCheckAll =
      checkAllOutput.includes("[juninho:check-all] Command: sh .opencode/scripts/check-all.sh") &&
      checkAllOutput.includes("[juninho:check-all] Running formatting checks...") &&
      checkAllOutput.includes("[juninho:check-all] Running build verification...") &&
      checkAllOutput.includes("[juninho:check-all] Running repo-wide tests...")
    const passedCheckAll =
      checkAllOutput.includes("[juninho:check-all] Result: PASS") &&
      checkAllOutput.includes("[juninho:check-all] Exit code: 0")
    if (!ranCheckAll || !passedCheckAll) {
      return "check loop did not run check-all.sh"
    }

    return null
  }

  if (index === 15) {
    if (!result.actualAnswer.includes("unify-loop=ready")) return "unify loop outcome missing"

    const descendants = exportDescendantSessions(parseEvents(result.transcriptPath))
    const agents = descendants.map((session) => exportedSessionAgent(session)).filter(Boolean)
    if (!agents.includes("j.unify")) return "unify command did not invoke j.unify"

    const integrationPath = path.join(result.sandboxPath, "docs", "specs", "feature-x", "state", "integration-state.json")
    if (!existsSync(integrationPath)) return "unify loop missing integration manifest"
    const integration = JSON.parse(readFileSync(integrationPath, "utf-8")) as any
    const cleanup = integration?.tasks?.["1"]?.cleanup
    if (!cleanup || cleanup.status !== "done") return "unify loop did not record cleanup status"

    const taskOutputs = collectToolOutputs(parseEvents(result.transcriptPath), "task").join("\n")
    if (!taskOutputs.includes("# Unify Report")) return "unify loop did not return unify report"
    if (!taskOutputs.includes("disabled by workflow-config") && !taskOutputs.includes("createPullRequest") && !taskOutputs.includes("PR")) {
      return "unify report did not mention closeout action results"
    }

    return null
  }

  if (index === 16) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("checker-startup-context=ready")) return "checker startup context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export checker child session transcript"
    const child = childSessions[0]
    if (exportedSessionAgent(child) !== "j.checker") return "startup context eval did not invoke j.checker"

    const systems = childSystemPrompts(child)
    if (!systems.some((system) => system.includes("[carl-inject] Delegated session startup context"))) {
      return "checker session did not receive delegated startup context"
    }
    if (!systems.some((system) => system.includes("CHECKER-PRINCIPLE-MARKER"))) return "checker startup context missing principle marker"
    if (!systems.some((system) => system.includes("CHECKER-ORDERS-MARKER"))) return "checker startup context missing orders marker"
    if (!systems.some((system) => system.includes("CHECKER-BALANCE-MARKER"))) return "checker startup context missing balance marker"
    if (systems.some((system) => system.includes("CHECKER-CASHOUT-DISTRACTOR"))) return "checker startup context included cashout distractor"

    return null
  }

  if (index === 17) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("planner-startup-context=ready")) return "planner startup context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export planner child session transcript"
    const child = childSessions[0]
    if (exportedSessionAgent(child) !== "j.planner") return "startup context eval did not invoke j.planner"

    const systems = childSystemPrompts(child)
    if (!systems.some((system) => system.includes("[carl-inject] Delegated session startup context"))) {
      return "planner session did not receive delegated startup context"
    }
    if (!systems.some((system) => system.includes("PLANNER-PRINCIPLE-MARKER"))) return "planner startup context missing principle marker"
    if (!systems.some((system) => system.includes("PLANNER-ORDERS-MARKER"))) return "planner startup context missing orders marker"
    if (!systems.some((system) => system.includes("PLANNER-BALANCE-MARKER"))) return "planner startup context missing balance marker"
    if (systems.some((system) => system.includes("PLANNER-CASHOUT-DISTRACTOR"))) return "planner startup context included cashout distractor"

    return null
  }

  if (index === 18) {
    if (!result.toolMetrics.task || result.toolMetrics.task.count < 1) return "expected task tool usage"
    if (!result.actualAnswer.includes("spec-startup-context=ready")) return "spec startup context outcome missing"

    const childSessions = exportChildSessions(events)
    if (childSessions.length === 0) return "could not export spec child session transcript"
    const child = childSessions[0]
    if (exportedSessionAgent(child) !== "j.spec-writer") return "startup context eval did not invoke j.spec-writer"

    const systems = childSystemPrompts(child)
    if (!systems.some((system) => system.includes("[carl-inject] Delegated session startup context"))) {
      return "spec session did not receive delegated startup context"
    }
    if (!systems.some((system) => system.includes("SPEC-CASHOUT-MARKER"))) return "spec startup context missing cashout marker"
    if (!systems.some((system) => system.includes("SPEC-BALANCE-MARKER"))) return "spec startup context missing balance marker"
    if (systems.some((system) => system.includes("SPEC-WEB-DISTRACTOR"))) return "spec startup context included web distractor"

    return null
  }

  if (index === 19) {
    const mapperPath = path.join(result.sandboxPath, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper", "SampleAggregateMapper.kt")
    if (!existsSync(mapperPath)) return "mapper file was not created"
    const mapper = readFileSync(mapperPath, "utf-8")
    const skillMarker = extractMapperSkillMarker(result.sandboxPath)
    if (!mapper.includes("Function<") && !mapper.includes("BiFunction<")) return "mapper did not use manual Function/BiFunction style"
    if (/fun\s+\w+\.to[A-Z]/.test(mapper)) return "mapper introduced extension mapping function"
    if (!skillMarker || !mapper.includes(skillMarker)) return "mapper did not apply skill-specific marker"
    if (!result.toolMetrics.skill || result.toolMetrics.skill.count < 1) return "expected mapper skill usage"
    const comparison = compareMapperWithAndWithoutSkill()
    if (comparison) return comparison
    return result.actualAnswer.includes("mapper-guidance=used") ? null : "mapper guidance outcome missing"
  }

  return null
}

function markdownReport(results: EvalResult[]): string {
  const total = results.length
  const passed = results.filter((result) => !result.taskError && result.exactAnswerMatch !== false).length
  let report = "# OpenCode Behavioral Eval Report\n\n"
  report += `- Tasks: ${total}\n`
  report += `- Passed: ${passed}/${total}\n\n`

  for (const [index, result] of results.entries()) {
    report += `## Task ${index + 1}\n\n`
    report += `- Question: ${result.question}\n`
    report += `- Preferred tool: ${result.preferredTool || "n/a"}\n`
    report += `- Preferred tool used: ${result.preferredToolUsed ? "yes" : "no"}\n`
    report += `- Tool calls: ${result.totalToolCalls}\n`
    report += `- Duration: ${(result.totalDurationMs / 1000).toFixed(2)}s\n`
    report += `- Transcript: ${result.transcriptPath}\n`
    report += `- Sandbox: ${result.sandboxPath}\n`
    report += `- Orchestrator feedback: ${result.orchestratorFeedback || "<none>"}\n`
    if (result.expectedAnswer) report += `- Expected answer: ${result.expectedAnswer}\n`
    report += `- Actual answer: ${result.actualAnswer || "<empty>"}\n`
    if (result.taskError) report += `- Task error: ${result.taskError}\n`
    if (result.exactAnswerMatch !== null) report += `- Answer match: ${result.exactAnswerMatch ? "yes" : "no"}\n`
    report += "```json\n"
    report += `${JSON.stringify(result.toolMetrics, null, 2)}\n`
    report += "```\n\n"
  }

  return report
}

async function main() {
  const evalFile = process.argv[2] || path.join(path.resolve(currentDir, ".."), "behavioral.xml")
  const outputFile = process.argv[3] || path.join(path.resolve(currentDir, ".."), "reports", "behavioral-eval-report.md")
  const offset = Number(process.env.JUNINHO_EVAL_OFFSET || "0")
  const limitRaw = process.env.JUNINHO_EVAL_LIMIT
  const limit = limitRaw ? Number(limitRaw) : null
  const tasks = parseEvaluationFile(evalFile)
  const selectedTasks = tasks.slice(offset, limit ? offset + limit : undefined)
  const results: EvalResult[] = []

  for (const [localIndex, task] of selectedTasks.entries()) {
    const index = offset + localIndex
    const sandboxPath = mktemp("juninho-behavioral-")
    seedHarnessSandboxForTask(sandboxPath, index)
    const result = runOpencodeEval(task, sandboxPath)
    const postError = postCheck(result, index)
    if (postError) result.taskError = result.taskError ? `${result.taskError}; ${postError}` : postError
    if (!result.taskError && result.exactAnswerMatch === false) result.taskError = "final answer did not match expected rubric"
    results.push(result)
  }

  mkdirSync(path.dirname(outputFile), { recursive: true })
  await writeFile(outputFile, markdownReport(results), "utf-8")
  const failed = results.filter((result) => Boolean(result.taskError)).length
  console.log(`Saved behavioral eval report to ${outputFile}`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
