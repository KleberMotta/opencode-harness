import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { loadPlugin, PluginHarness } from "../../lib/plugin-harness"
import {
  createTempDir,
  removeDir,
  repoRoot,
  writeActivePlan,
  writeExecutionState,
  writePersistentContext,
} from "../../lib/test-utils"

let tempRoot = ""

type MockSessionClient = {
  session: {
    status: (args: { directory?: string }) => Promise<unknown>
    abort: (args: { sessionID: string; directory?: string }) => Promise<unknown>
    delete: (args: { sessionID: string; directory?: string }) => Promise<unknown>
    create: (args: { directory?: string; parentID?: string; title?: string }) => Promise<unknown>
    promptAsync: (args: {
      sessionID: string
      directory?: string
      agent?: string
      parts?: Array<{ type: string; text?: string }>
    }) => Promise<unknown>
  }
}

beforeEach(() => {
  tempRoot = createTempDir("juninho-context-")
  mkdirSync(path.join(tempRoot, ".opencode", "state"), { recursive: true })
  mkdirSync(path.join(tempRoot, ".opencode", "skills", "j.controller-writing"), { recursive: true })
  mkdirSync(path.join(tempRoot, ".opencode", "skills", "j.mapper-writing"), { recursive: true })
  mkdirSync(path.join(tempRoot, "docs", "principles"), { recursive: true })
  mkdirSync(path.join(tempRoot, "docs", "domain"), { recursive: true })
  mkdirSync(path.join(tempRoot, "docs", "specs", "feature-x"), { recursive: true })
  mkdirSync(path.join(tempRoot, "docs", "specs", "feature-x", "state"), { recursive: true })
  mkdirSync(path.join(tempRoot, "src", "feature"), { recursive: true })
  mkdirSync(path.join(tempRoot, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper"), { recursive: true })

  writeFileSync(
    path.join(tempRoot, ".opencode", "skill-map.json"),
    JSON.stringify([
      { pattern: "Controller\\.kt$", skill: "j.controller-writing" },
      { pattern: ".*Mapper(?:Helper)?\\.kt$", skill: "j.mapper-writing" },
    ], null, 2) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, ".opencode", "skills", "j.controller-writing", "SKILL.md"),
    "---\nname: j.controller-writing\ndescription: test skill\n---\n\n## When this skill activates\n\nController files.\n\n## Required Steps\n- Keep controllers thin.\n\n## Anti-patterns to avoid\n- Business logic in controller.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, ".opencode", "skills", "j.mapper-writing", "SKILL.md"),
    "---\nname: j.mapper-writing\ndescription: test mapper skill\n---\n\n## When this skill activates\n\nMapper files.\n\n## Required Steps\n- Marker: MAPPER-SKILL-MARKER\n- Prefer manual Function/BiFunction mappers for aggregate assembly.\n- Avoid extension mapping functions.\n\n## Anti-patterns to avoid\n- Business logic in mapper.\n",
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, "docs", "principles", "manifest"),
    [
      "API_STATE=active",
      "API_RECALL=controller,endpoint",
      "API_FILE=docs/principles/api-patterns.md",
      "API_PRIORITY=1",
      "API_ALWAYS=true",
      "PAYMENT_STATE=active",
      "PAYMENT_RECALL=payment,settlement,order,release,reverse",
      "PAYMENT_FILE=docs/principles/payment-patterns.md",
      "PAYMENT_PRIORITY=2",
      "TEST_STATE=active",
      "TEST_RECALL=test,unit,integration",
      "TEST_FILE=docs/principles/test-patterns.md",
      "TEST_PRIORITY=3",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(path.join(tempRoot, "docs", "principles", "api-patterns.md"), "# API Patterns\nThin controllers only.\n", "utf-8")
  writeFileSync(path.join(tempRoot, "docs", "principles", "payment-patterns.md"), "# Payment Patterns\nLock and validate settlement flows.\n", "utf-8")
  writeFileSync(path.join(tempRoot, "docs", "principles", "test-patterns.md"), "# Test Patterns\nTEST-DISTRACTOR\n", "utf-8")
  writeFileSync(
    path.join(tempRoot, "docs", "domain", "INDEX.md"),
    "## Orders\nKeywords: order, payment settlement, settlement workflow, release, reverse\nFiles:\n- orders.md — Order settlement workflow\n\n## Cashout\nKeywords: cashout, withdrawal, payout, transfer\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, escrow, available, ledger\nFiles:\n- balance.md — Balance movements\n\n## Web\nKeywords: controller, request, response\nFiles:\n- web.md — Generic web workflow\n",
    "utf-8"
  )
  writeFileSync(path.join(tempRoot, "docs", "domain", "orders.md"), "# Orders\nORDER-DOMAIN-MARKER\nSettlement domain.\n", "utf-8")
  writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-DISTRACTOR\n", "utf-8")
  writeFileSync(path.join(tempRoot, "docs", "domain", "balance.md"), "# Balance\nBALANCE-DISTRACTOR\n", "utf-8")
  writeFileSync(path.join(tempRoot, "docs", "domain", "web.md"), "# Web\nDOMAIN-WEB-DISTRACTOR\n", "utf-8")
  writeFileSync(path.join(tempRoot, "src", "AGENTS.md"), "# Src Rules\n\nUse application services.\n", "utf-8")
  writeFileSync(
    path.join(tempRoot, "src", "feature", "SampleController.kt"),
    "class SampleController { fun handlePayment() = Unit }\n",
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper", "SampleAggregateMapper.kt"),
    "class SampleAggregateMapper\n",
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
    markdownPlanTask({
      action: "Update the payment settlement controller and keep it thin.",
      verification: "Run the focused controller test.",
      done: "Controller delegates to the correct service without settlement business logic.",
      contextReference: "`CONTEXT.md#payment-controller` — Keep payment controller thin.",
    }),
    "utf-8"
  )
  writeFileSync(
    path.join(tempRoot, "src", "feature", "OutOfScope.kt"),
    "class OutOfScope\n",
    "utf-8"
  )
})

afterEach(() => {
  removeDir(tempRoot)
})

function markdownPlanTask(options: {
  id?: string
  name?: string
  wave?: string
  depends?: string
  files?: string[]
  action: string
  verification?: string
  done: string
  contextReference?: string
}): string {
  return [
    "# Plan: Feature X",
    "",
    "- **Goal**: Test feature plan.",
    "- **Spec**: docs/specs/feature-x/spec.md",
    "- **Context**: docs/specs/feature-x/CONTEXT.md",
    "- **Intent Type**: FEATURE",
    "- **Complexity**: MEDIUM",
    "",
    `## Task ${options.id ?? "1"} — ${options.name ?? "Update sample flow"}`,
    "- **Project**: test/repo",
    `- **Wave**: ${options.wave ?? "1"}`,
    "- **Agent**: j.implementer",
    `- **Depends**: ${options.depends ?? "None"}`,
    "- **Skills**: j.service-writing",
    "",
    "### Context References",
    `- ${options.contextReference ?? "`CONTEXT.md#test-context` — Test context."}`,
    "",
    "### Files",
    ...(options.files ?? ["src/feature/SampleController.kt"]).map((file) => `- \`${file}\``),
    "",
    "### Action",
    options.action,
    "",
    "### Verification",
    `- ${options.verification ?? "Run the focused test."}`,
    "",
    "### Done Criteria",
    `- ${options.done}`,
    "",
  ].join("\n")
}

async function createHarness(pluginNames: string[], options?: { client?: MockSessionClient; directory?: string }) {
  const root = repoRoot()
  const plugins = []
  for (const pluginName of pluginNames) {
    plugins.push(await loadPlugin(path.join(root, ".opencode", "plugins", pluginName), options?.directory ?? tempRoot, options))
  }
  return new PluginHarness(plugins)
}

describe("context injection plugins", () => {
  test("plan-autoload injects active plan on first chat message and during compaction", async () => {
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.plan-autoload.ts"])

    const chatOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "s-1" }, chatOutput)
    expect(chatOutput.message.system).toContain("[plan-autoload] Active plan detected")
    expect(chatOutput.message.system).toContain("SampleController.kt")

    const compactOutput = { context: [] as string[] }
    await harness.runCompaction({ sessionID: "s-1" }, compactOutput)
    expect(compactOutput.context.join("\n")).toContain("[plan-autoload] Active plan detected")
  })

  test("memory injects persistent context once per session and re-injects on compaction", async () => {
    writePersistentContext(tempRoot, "Always protect settlement invariants.")
    const harness = await createHarness(["j.memory.ts"])

    const firstOutput = { title: "Read", output: "body", metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "s-1", callID: "1", args: {} }, firstOutput)
    expect(firstOutput.output).toContain("[memory] Project memory")

    const secondOutput = { title: "Read", output: "body", metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "s-1", callID: "2", args: {} }, secondOutput)
    expect(secondOutput.output).not.toContain("[memory] Project memory")

    const compactOutput = { context: [] as string[] }
    await harness.runCompaction({ sessionID: "s-1" }, compactOutput)
    expect(compactOutput.context.join("\n")).toContain("Always protect settlement invariants.")
  })

  test("directory agents and skill injectors are isolated per session", async () => {
    const harness = await createHarness(["j.directory-agents-injector.ts", "j.skill-inject.ts"])
    const filePath = path.join(tempRoot, "src", "feature", "SampleController.kt")

    const firstSession = { title: "Read", output: readFileSync(filePath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "s-1", callID: "1", args: { file_path: filePath } }, firstSession)
    expect(firstSession.output).toContain("[directory-agents-injector] Context from src/AGENTS.md")
    expect(firstSession.output).toContain("[skill-inject] Skill activated for j.controller-writing")

    const secondSession = { title: "Read", output: readFileSync(filePath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "s-2", callID: "1", args: { file_path: filePath } }, secondSession)
    expect(secondSession.output).toContain("[directory-agents-injector] Context from src/AGENTS.md")
    expect(secondSession.output).toContain("[skill-inject] Skill activated for j.controller-writing")
  })

  test("skill injector activates mapper skill for mapper files only", async () => {
    const harness = await createHarness(["j.skill-inject.ts"])
    const mapperPath = path.join(tempRoot, "src", "main", "kotlin", "br", "com", "olx", "trp", "financial", "domain", "order", "mapper", "SampleAggregateMapper.kt")
    const nonTriggerPath = path.join(tempRoot, "src", "feature", "OutOfScope.kt")

    const mapperSession = { title: "Read", output: readFileSync(mapperPath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "mapper-s-1", callID: "1", args: { file_path: mapperPath } }, mapperSession)
    expect(mapperSession.output).toContain("[skill-inject] Skill activated for j.mapper-writing")
    expect(mapperSession.output).toContain("MAPPER-SKILL-MARKER")

    const nonTriggerSession = { title: "Read", output: readFileSync(nonTriggerPath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "mapper-s-2", callID: "1", args: { file_path: nonTriggerPath } }, nonTriggerSession)
    expect(nonTriggerSession.output).not.toContain("j.mapper-writing")
  })

  test("skill injector activates multiple skills when multiple patterns match the same file", async () => {
    writeFileSync(
      path.join(tempRoot, ".opencode", "skill-map.json"),
      JSON.stringify([
        { pattern: "Controller\\.kt$", skill: "j.controller-writing" },
        { pattern: "SampleController\\.kt$", skill: "j.mapper-writing" },
      ], null, 2) + "\n",
      "utf-8"
    )

    const harness = await createHarness(["j.skill-inject.ts"])
    const filePath = path.join(tempRoot, "src", "feature", "SampleController.kt")

    const session = { title: "Read", output: readFileSync(filePath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "multi-s-1", callID: "1", args: { file_path: filePath } }, session)

    expect(session.output).toContain("[skill-inject] Skill activated for j.controller-writing")
    expect(session.output).toContain("[skill-inject] Skill activated for j.mapper-writing")
    expect(session.output).toContain("MAPPER-SKILL-MARKER")
  })

  test("carl preloads task-scoped and canonical context for child sessions before reads", async () => {
    writeExecutionState(tempRoot, "**Goal**: update payment controller\n- [ ] task: update payment endpoint\n")
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    const filePath = path.join(tempRoot, "src", "feature", "SampleController.kt")

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-1", callID: "1" },
      {
        args: {
          prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-1",
        info: {
          parentID: "parent-1",
          title: "Execute task 1",
        },
      },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-1" }, startupOutput)
    expect(startupOutput.message.system).toContain("[carl-inject] Task-scoped startup context")
    expect(startupOutput.message.system).toContain("Principle (API)")
    expect(startupOutput.message.system).toContain("Principle (PAYMENT)")
    expect(startupOutput.message.system).toContain("Domain (Orders / orders.md)")
    expect(startupOutput.message.system).not.toContain("Principle (TEST)")
    expect(startupOutput.message.system).not.toContain("Domain (Cashout / cashout.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Balance / balance.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Web / web.md)")
    expect(startupOutput.message.system).not.toContain("TEST-DISTRACTOR")
    expect(startupOutput.message.system).not.toContain("CASHOUT-DISTRACTOR")
    expect(startupOutput.message.system).not.toContain("BALANCE-DISTRACTOR")
    expect(startupOutput.message.system).not.toContain("DOMAIN-WEB-DISTRACTOR")
    expect(startupOutput.message.system).toContain("Use this before searching the repo")

    const firstOutput = { title: "Read", output: readFileSync(filePath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "child-1", callID: "1", args: { file_path: filePath } }, firstOutput)
    expect(firstOutput.output).not.toContain("[carl-inject] Principle (API)")
    expect(firstOutput.output).not.toContain("[carl-inject] Domain (Orders / orders.md)")

    const compactOutput = { context: [] as string[] }
    await harness.runCompaction({ sessionID: "child-1" }, compactOutput)
    expect(compactOutput.context.join("\n")).toContain("Previously injected context")

    const secondOutput = { title: "Read", output: readFileSync(filePath, "utf-8"), metadata: {} }
    await harness.runToolAfter({ tool: "Read", sessionID: "child-2", callID: "1", args: { file_path: filePath } }, secondOutput)
    expect(secondOutput.output).toContain("[carl-inject] Principle (API)")
  })

  test("carl parses canonical markdown plan task context", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Cashout\nKeywords: cashout, payout, settlement\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, ledger\nFiles:\n- balance.md — Balance workflow\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nMARKDOWN-PLAN-CASHOUT\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "balance.md"), "# Balance\nMARKDOWN-PLAN-BALANCE-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      [
        "# Plan: Cashout Settlement",
        "",
        "## Task 1 — Update cashout payout settlement",
        "- **Project**: test/repo",
        "- **Wave**: 1",
        "- **Agent**: j.implementer",
        "- **Depends**: None",
        "- **Skills**: j.service-writing",
        "",
        "### Context References",
        "- `CONTEXT.md#cashout-settlement-rules` — preserve cashout payout settlement behavior.",
        "",
        "### Files",
        "- `src/feature/SampleController.kt`",
        "",
        "### Action",
        "Update the cashout payout settlement flow and keep unrelated account-book changes out of scope.",
        "",
        "### Verification",
        "- Run focused cashout payout test.",
        "",
        "### Done Criteria",
        "- Cashout payout settlement behavior is preserved without unrelated account-book changes.",
      ].join("\n"),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-markdown-plan", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1" } }
    )
    await harness.runEvent({
      type: "session.created",
      properties: { sessionID: "child-markdown-plan", info: { parentID: "parent-markdown-plan", title: "Execute task 1" } },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-markdown-plan" }, startupOutput)
    expect(startupOutput.message.system).toContain("MARKDOWN-PLAN-CASHOUT")
    expect(startupOutput.message.system).not.toContain("MARKDOWN-PLAN-BALANCE-DISTRACTOR")
  })

  test("carl keeps orders context ahead of messaging distractors for workflow listeners", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Orders\nKeywords: order, release, reverse, settlement workflow\nFiles:\n- orders.md — Order workflow\n\n## Messaging\nKeywords: event, queue, topic, listener, sns, sqs\nFiles:\n- messaging.md — Messaging contracts\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "orders.md"), "# Orders\nORDERS-WINS-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "messaging.md"), "# Messaging\nMESSAGING-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the order release listener event handling for settlement workflow retries.",
        verification: "Run the focused order listener test.",
        done: "Order release workflow keeps the listener thin and preserves order state transitions.",
        contextReference: "`CONTEXT.md#order-release` — Preserve order release workflow retries.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-orders", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-orders", info: { parentID: "parent-orders", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-orders" }, startupOutput)
    expect(startupOutput.message.system).toContain("ORDERS-WINS-MARKER")
    expect(startupOutput.message.system).not.toContain("MESSAGING-DISTRACTOR")
  })

  test("carl keeps cashout context ahead of batch and bank-account distractors", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Cashout\nKeywords: cashout, withdrawal, payout, scheduled send, transfer\nFiles:\n- cashout.md — Cashout workflow\n\n## Batch\nKeywords: batch, payout batch, transfer batch, scheduled send, batch zero\nFiles:\n- batch.md — Batch scheduling\n\n## Bank-account\nKeywords: bank account, favorite account, payout account\nFiles:\n- bank-account.md — Bank account rules\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-WINS-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "batch.md"), "# Batch\nBATCH-DISTRACTOR\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "bank-account.md"), "# Bank Account\nBANK-ACCOUNT-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the cashout transfer flow to keep the payout transfer logic safe when scheduled send retries happen.",
        verification: "Run the focused cashout transfer test.",
        done: "Cashout transfer keeps its own workflow rules without changing batch assignment or bank-account ownership behavior.",
        contextReference: "`CONTEXT.md#cashout-transfer` — Preserve cashout transfer rules.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-cashout", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-cashout", info: { parentID: "parent-cashout", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-cashout" }, startupOutput)
    expect(startupOutput.message.system).toContain("CASHOUT-WINS-MARKER")
    expect(startupOutput.message.system).not.toContain("BATCH-DISTRACTOR")
    expect(startupOutput.message.system).not.toContain("BANK-ACCOUNT-DISTRACTOR")
  })

  test("carl can combine orders domain with async principle without pulling messaging domain", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "principles", "manifest"),
      [
        "API_STATE=active",
        "API_RECALL=controller,endpoint",
        "API_FILE=docs/principles/api-patterns.md",
        "API_PRIORITY=1",
        "API_ALWAYS=true",
        "ASYNC_STATE=active",
        "ASYNC_RECALL=listener,event,queue,topic,replay",
        "ASYNC_FILE=docs/principles/async-messaging-patterns.md",
        "ASYNC_PRIORITY=2",
        "PAYMENT_STATE=active",
        "PAYMENT_RECALL=payment,settlement,order,release,reverse",
        "PAYMENT_FILE=docs/principles/payment-patterns.md",
        "PAYMENT_PRIORITY=3",
        "",
      ].join("\n"),
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "principles", "async-messaging-patterns.md"), "# Async Messaging Patterns\nASYNC-PRINCIPLE-MARKER\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Orders\nKeywords: order, release, reverse, settlement workflow\nFiles:\n- orders.md — Order workflow\n\n## Messaging\nKeywords: event, queue, topic, listener, sns, sqs\nFiles:\n- messaging.md — Messaging contracts\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "orders.md"), "# Orders\nORDERS-ASYNC-WINS-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "messaging.md"), "# Messaging\nMESSAGING-DOMAIN-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the order release listener to handle settlement workflow replay events safely.",
        verification: "Run the focused order listener test.",
        done: "Order workflow transitions remain correct and the listener stays thin.",
        contextReference: "`CONTEXT.md#order-replay` — Preserve order workflow replay behavior.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-async", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-async", info: { parentID: "parent-async", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-async" }, startupOutput)
    expect(startupOutput.message.system).toContain("ORDERS-ASYNC-WINS-MARKER")
    expect(startupOutput.message.system).toContain("ASYNC-PRINCIPLE-MARKER")
    expect(startupOutput.message.system).not.toContain("MESSAGING-DOMAIN-DISTRACTOR")
  })

  test("carl preserves legitimate dual-domain startup context when cashout processing depends on batch rules", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Cashout\nKeywords: cashout, payout, transfer, withdrawal, cashout processing\nFiles:\n- cashout.md — Cashout workflow\n\n## Batch\nKeywords: batch, processing, transfer batch, scheduled send, batch zero\nFiles:\n- batch.md — Batch scheduling\n\n## Bank-account\nKeywords: bank account, favorite account, payout account\nFiles:\n- bank-account.md — Bank account rules\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-DUAL-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "batch.md"), "# Batch\nBATCH-DUAL-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "bank-account.md"), "# Bank Account\nBANK-ACCOUNT-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the cashout batch processing flow so scheduled send retries keep the batch assignment and transfer behavior consistent.",
        verification: "Run the focused cashout batch processing test.",
        done: "Cashout processing keeps both transfer rules and batch scheduling behavior aligned.",
        contextReference: "`CONTEXT.md#cashout-batch` — Preserve cashout batch processing behavior.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-dual", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-dual", info: { parentID: "parent-dual", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-dual" }, startupOutput)
    expect(startupOutput.message.system).toContain("CASHOUT-DUAL-MARKER")
    expect(startupOutput.message.system).toContain("BATCH-DUAL-MARKER")
    expect(startupOutput.message.system).not.toContain("BANK-ACCOUNT-DISTRACTOR")
  })

  test("carl preserves legitimate cashout plus balance startup context without pulling batch", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Cashout\nKeywords: cashout, payout, transfer, withdrawal, cashout approval\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, available, escrow, debit, credit\nFiles:\n- balance.md — Balance movements\n\n## Batch\nKeywords: batch, transfer batch, scheduled send, batch zero\nFiles:\n- batch.md — Batch scheduling\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-BALANCE-CASHOUT-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "balance.md"), "# Balance\nCASHOUT-BALANCE-BALANCE-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "batch.md"), "# Batch\nCASHOUT-BALANCE-BATCH-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the cashout approval flow so balance debits and cashout state changes stay consistent.",
        verification: "Run the focused cashout conclusion test.",
        done: "Cashout approval preserves both cashout workflow and balance mutation rules.",
        contextReference: "`CONTEXT.md#cashout-approval` — Preserve cashout approval and balance behavior.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-cashout-balance", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-cashout-balance", info: { parentID: "parent-cashout-balance", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-cashout-balance" }, startupOutput)
    expect(startupOutput.message.system).toContain("CASHOUT-BALANCE-CASHOUT-MARKER")
    expect(startupOutput.message.system).toContain("CASHOUT-BALANCE-BALANCE-MARKER")
    expect(startupOutput.message.system).not.toContain("CASHOUT-BALANCE-BATCH-DISTRACTOR")
  })

  test("carl stays stable with sandbox principles and domain index for an order settlement task", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "principles", "manifest"),
      [
        "API_STATE=active",
        "API_RECALL=controller,endpoint",
        "API_FILE=docs/principles/api-patterns.md",
        "API_PRIORITY=1",
        "API_ALWAYS=true",
        "WORKFLOW_STATE=active",
        "WORKFLOW_RECALL=order,settlement,release,state,workflow,balance",
        "WORKFLOW_FILE=docs/principles/workflow-patterns.md",
        "WORKFLOW_PRIORITY=2",
        "ASYNC_STATE=active",
        "ASYNC_RECALL=message,queue,topic,sns,sqs",
        "ASYNC_FILE=docs/principles/async-messaging-patterns.md",
        "ASYNC_PRIORITY=3",
        "",
      ].join("\n"),
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "principles", "api-patterns.md"), "# API Patterns\nThin controllers only.\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "principles", "workflow-patterns.md"), "# Workflow Patterns\nWORKFLOW-PRINCIPLE-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "principles", "async-messaging-patterns.md"), "# Messaging\nASYNC-DISTRACTOR\n", "utf-8")
    writeFileSync(
      path.join(tempRoot, "docs", "domain", "INDEX.md"),
      "## Orders\nKeywords: order, settlement, release, workflow\nFiles:\n- orders.md — Order workflow\n\n## Messaging\nKeywords: event, queue, topic, sns, sqs\nFiles:\n- messaging.md — Messaging workflow\n\n## Cashout\nKeywords: cashout, payout\nFiles:\n- cashout.md — Cashout workflow\n\n## Balance\nKeywords: balance, ledger\nFiles:\n- balance.md — Balance workflow\n",
      "utf-8"
    )
    writeFileSync(path.join(tempRoot, "docs", "domain", "orders.md"), "# Orders\nORDER-DOMAIN-MARKER\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "messaging.md"), "# Messaging\nMESSAGING-DISTRACTOR\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "cashout.md"), "# Cashout\nCASHOUT-DISTRACTOR\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "domain", "balance.md"), "# Balance\nBALANCE-DISTRACTOR\n", "utf-8")

    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({
        action: "Update the order settlement workflow release behavior and preserve state transitions.",
        verification: "Run the focused order release test.",
        done: "Order release keeps workflow and balance invariants aligned.",
        contextReference: "`CONTEXT.md#order-settlement` — Preserve order settlement state transitions.",
      }),
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.task-runtime.ts", "j.carl-inject.ts"])
    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-real", callID: "1" },
      { args: { prompt: "Execute task 1\nAttempt: 1\nFocus on src/feature/SampleController.kt" } }
    )
    await harness.runEvent({ type: "session.created", properties: { sessionID: "child-real", info: { parentID: "parent-real", title: "Execute task 1" } } })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-real" }, startupOutput)
    expect(startupOutput.message.system).toContain("WORKFLOW-PRINCIPLE-MARKER")
    expect(startupOutput.message.system).toContain("ORDER-DOMAIN-MARKER")
    expect(startupOutput.message.system).not.toContain("# Messaging")
  })

  test("carl preloads checker startup context from delegated prompt and active plan artifacts", async () => {
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "spec.md"),
      "# Spec\n\nPreserve order settlement workflow invariants.\n",
      "utf-8"
    )
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "CONTEXT.md"),
      "# Context\n\nReview order settlement and balance safety before shipping.\n",
      "utf-8"
    )
    writeFileSync(
      path.join(tempRoot, "docs", "specs", "feature-x", "state", "functional-validation-plan.md"),
      "# Validation Plan\n\nValidate order settlement and available balance behavior.\n",
      "utf-8"
    )

    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.carl-inject.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-check", callID: "1" },
      {
        args: {
          subagent_type: "j.checker",
          prompt: "Run /j.check for docs/specs/feature-x/plan.md and verify the order settlement flow, review balance risks, and use docs/specs/feature-x/state/functional-validation-plan.md.",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "checker-session",
        info: {
          parentID: "parent-check",
          title: "Run j.checker",
        },
      },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "checker-session" }, startupOutput)
    expect(startupOutput.message.system).toContain("[carl-inject] Delegated session startup context")
    expect(startupOutput.message.system).toContain("Principle (PAYMENT)")
    expect(startupOutput.message.system).toContain("Domain (Orders / orders.md)")
    expect(startupOutput.message.system).toContain("Domain (Balance / balance.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Cashout / cashout.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Web / web.md)")
  })

  test("carl preloads planner startup context from delegated feature goal", async () => {
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.carl-inject.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-plan", callID: "1" },
      {
        args: {
          subagent_type: "j.planner",
          prompt: "Create docs/specs/feature-x/plan.md for an order settlement release fix that preserves balance invariants and avoids messaging drift.",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "planner-session",
        info: {
          parentID: "parent-plan",
          title: "Run j.planner",
        },
      },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "planner-session" }, startupOutput)
    expect(startupOutput.message.system).toContain("[carl-inject] Delegated session startup context")
    expect(startupOutput.message.system).toContain("Principle (PAYMENT)")
    expect(startupOutput.message.system).toContain("Domain (Orders / orders.md)")
    expect(startupOutput.message.system).toContain("Domain (Balance / balance.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Cashout / cashout.md)")
  })

  test("carl preloads spec-writer startup context from delegated feature prompt", async () => {
    const harness = await createHarness(["j.carl-inject.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-spec", callID: "1" },
      {
        args: {
          subagent_type: "j.spec-writer",
          prompt: "Write docs/specs/feature-x/spec.md for a cashout approval change that keeps cashout approval state transitions, balance debits, payout transfer, and escrow consistency, without changing batch scheduling.",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "spec-session",
        info: {
          parentID: "parent-spec",
          title: "Run j.spec-writer",
        },
      },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "spec-session" }, startupOutput)
    expect(startupOutput.message.system).toContain("[carl-inject] Delegated session startup context")
    expect(startupOutput.message.system).toContain("Domain (Cashout / cashout.md)")
    expect(startupOutput.message.system).toContain("Domain (Balance / balance.md)")
    expect(startupOutput.message.system).not.toContain("Domain (Web / web.md)")
  })

  test("intent gate warns only for out-of-plan writes", async () => {
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.intent-gate.ts"])

    const inScope = { title: "Edit", output: "ok", metadata: {} }
    await harness.runToolAfter(
      { tool: "Edit", sessionID: "s-1", callID: "1", args: { file_path: path.join(tempRoot, "src", "feature", "SampleController.kt") } },
      inScope
    )
    expect(inScope.output).not.toContain("[intent-gate]")

    const outOfScope = { title: "Edit", output: "ok", metadata: {} }
    await harness.runToolAfter(
      { tool: "Edit", sessionID: "s-1", callID: "2", args: { file_path: path.join(tempRoot, "src", "feature", "OutOfScope.kt") } },
      outOfScope
    )
    expect(outOfScope.output).toContain("[intent-gate] ⚠ SCOPE WARNING")
  })

  test("plan autoload includes plan, spec, and context contract pointers", async () => {
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")
    const harness = await createHarness(["j.plan-autoload.ts"])
    const output = { message: {}, parts: [] as unknown[] }

    await harness.runChatMessage({ sessionID: "plan-session" }, output)

    const system = typeof output.message.system === "string" ? output.message.system : ""
    expect(system).toContain("[plan-autoload] Active plan detected at docs/specs/feature-x/plan.md")
    expect(system).toContain("[plan-autoload] Spec contract: docs/specs/feature-x/spec.md")
    expect(system).toContain("[plan-autoload] Context contract: docs/specs/feature-x/CONTEXT.md")
  })

  test("plan autoload highlights multi-project write targets for implement loop", async () => {
    const repoA = path.join(tempRoot, "repo-a")
    const repoB = path.join(tempRoot, "repo-b")
    mkdirSync(path.join(repoA, ".git"), { recursive: true })
    mkdirSync(path.join(repoA, "docs", "specs", "feature-x"), { recursive: true })
    mkdirSync(path.join(repoB, ".git"), { recursive: true })
    mkdirSync(path.join(repoB, "docs", "specs", "feature-x"), { recursive: true })
    writeFileSync(path.join(repoA, "docs", "specs", "feature-x", "plan.md"), markdownPlanTask({ action: "Plan repo A task.", done: "Repo A task is planned." }), "utf-8")
    writeFileSync(path.join(repoB, "docs", "specs", "feature-x", "plan.md"), markdownPlanTask({ action: "Plan repo B task.", done: "Repo B task is planned." }), "utf-8")
    writeFileSync(
      path.join(tempRoot, ".opencode", "state", "active-plan.json"),
      JSON.stringify({
        slug: "feature-x",
        writeTargets: [
          {
            project: "repo-a",
            targetRepoRoot: repoA,
            planPath: "docs/specs/feature-x/plan.md",
            specPath: "docs/specs/feature-x/spec.md",
            contextPath: "docs/specs/feature-x/CONTEXT.md",
          },
          {
            project: "repo-b",
            targetRepoRoot: repoB,
            planPath: "docs/specs/feature-x/plan.md",
            specPath: "docs/specs/feature-x/spec.md",
            contextPath: "docs/specs/feature-x/CONTEXT.md",
          },
        ],
      }, null, 2) + "\n",
      "utf-8"
    )

    const harness = await createHarness(["j.plan-autoload.ts"])
    const output = { message: {}, parts: [] as unknown[] }

    await harness.runChatMessage({ sessionID: "multi-plan-session" }, output)

    const system = typeof output.message.system === "string" ? output.message.system : ""
    expect(system).toContain("[plan-autoload] Multi-project write targets:")
    expect(system).toContain("repo-a")
    expect(system).toContain("repo-b")
    expect(system).toContain("/j.implement must iterate every write target")
  })

  test("env protection blocks sensitive file access before execution", async () => {
    const harness = await createHarness(["j.env-protection.ts"])

    await expect(
      harness.runToolBefore(
        { tool: "Read", sessionID: "s-1", callID: "1" },
        { args: { file_path: path.join(tempRoot, ".env.test") } }
      )
    ).rejects.toThrow("[env-protection] Blocked access to sensitive file")
  })

  test("task runtime binds spawned task sessions to feature-local runtime files", async () => {
    const harness = await createHarness(["j.task-runtime.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-1", callID: "1" },
      {
        args: {
          prompt:
            "Execute task 7 for docs/specs/feature-x/plan.md\nAttempt: 2\nFocus on src/feature/SampleController.kt",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-7",
        info: {
          parentID: "parent-1",
          title: "Execute task 7",
        },
      },
    })

    const taskRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-7", "runtime.json")
    const sessionRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "sessions", "child-7-runtime.json")

    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      featureSlug: string
      taskID: string
      attempt: number
      stage: string
      planBranch: string
      planPath: string
      specPath: string
      contextPath: string
      parentSessionID: string
      ownerSessionID: string
    }
    const sessionRuntime = JSON.parse(readFileSync(sessionRuntimePath, "utf-8")) as {
      ownerSessionID: string
      taskID: string
    }

    expect(taskRuntime.featureSlug).toBe("feature-x")
    expect(taskRuntime.taskID).toBe("7")
    expect(taskRuntime.attempt).toBe(2)
    expect(taskRuntime.stage).toBe("implement")
    expect(taskRuntime.planBranch).toBe("feature/feature-x")
    expect(taskRuntime.planPath).toBe("docs/specs/feature-x/plan.md")
    expect(taskRuntime.specPath).toBe("docs/specs/feature-x/spec.md")
    expect(taskRuntime.contextPath).toBe("docs/specs/feature-x/CONTEXT.md")
    expect(taskRuntime.parentSessionID).toBe("parent-1")
    expect(taskRuntime.ownerSessionID).toBe("child-7")
    expect(sessionRuntime.ownerSessionID).toBe("child-7")
    expect(sessionRuntime.taskID).toBe("7")
  })

  test("task runtime extracts task id from behavioral harness phrasing", async () => {
    const harness = await createHarness(["j.task-runtime.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-behavioral", callID: "1" },
      {
        args: {
          prompt:
            "You are executing task 3 from the active plan for docs/specs/feature-x/plan.md\nAttempt: 2\nFocus on src/feature/SampleController.kt",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-behavioral",
        info: {
          parentID: "parent-behavioral",
          title: "You are executing task 3",
        },
      },
    })

    const taskRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-3", "runtime.json")
    const sessionRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "sessions", "child-behavioral-runtime.json")

    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      taskID: string
      attempt: number
      stage: string
      ownerSessionID: string
    }
    const sessionRuntime = JSON.parse(readFileSync(sessionRuntimePath, "utf-8")) as {
      taskID: string
      ownerSessionID: string
    }

    expect(taskRuntime.taskID).toBe("3")
    expect(taskRuntime.attempt).toBe(2)
    expect(taskRuntime.stage).toBe("implement")
    expect(taskRuntime.ownerSessionID).toBe("child-behavioral")
    expect(sessionRuntime.taskID).toBe("3")
    expect(sessionRuntime.ownerSessionID).toBe("child-behavioral")
  })

  test("task runtime prefers explicit structured stage metadata when provided", async () => {
    const harness = await createHarness(["j.task-runtime.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-stage", callID: "1" },
      {
        args: {
          prompt:
            "Stage: check-reentry\nTask: 9\nPlan: docs/specs/feature-x/plan.md\nAttempt: 3\nFix findings from check-review.md without reopening completed work.",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-stage",
        info: {
          parentID: "parent-stage",
          title: "Task 9 reentry",
        },
      },
    })

    const taskRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-9", "runtime.json")
    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      taskID: string
      attempt: number
      stage: string
      planPath: string
    }

    expect(taskRuntime.taskID).toBe("9")
    expect(taskRuntime.attempt).toBe(3)
    expect(taskRuntime.stage).toBe("check-reentry")
    expect(taskRuntime.planPath).toBe("docs/specs/feature-x/plan.md")
  })

  test("task runtime prefers explicit task contract over prompt heuristics", async () => {
    const harness = await createHarness(["j.task-runtime.ts"])
    const contractPath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-5", "task-contract.json")
    mkdirSync(path.dirname(contractPath), { recursive: true })
    writeFileSync(
      contractPath,
      JSON.stringify(
        {
          featureSlug: "feature-x",
          taskID: "5",
          attempt: 4,
          stage: "validate",
          planPath: "docs/specs/feature-x/plan.md",
          specPath: "docs/specs/feature-x/spec.md",
          contextPath: "docs/specs/feature-x/CONTEXT.md",
          taskContractPath: "docs/specs/feature-x/state/tasks/task-5/task-contract.json",
        },
        null,
        2
      ) + "\n",
      "utf-8"
    )

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-contract", callID: "1" },
      {
        args: {
          prompt: "Execute task 99 for docs/specs/wrong-feature/plan.md\nAttempt: 1\nThis text should lose to the explicit contract.",
          task_contract_path: "docs/specs/feature-x/state/tasks/task-5/task-contract.json",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-contract",
        info: {
          parentID: "parent-contract",
          title: "Completely different title",
        },
      },
    })

    const taskRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-5", "runtime.json")
    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      taskID: string
      attempt: number
      stage: string
      planPath: string
      taskContractPath: string
    }

    expect(taskRuntime.taskID).toBe("5")
    expect(taskRuntime.attempt).toBe(4)
    expect(taskRuntime.stage).toBe("validate")
    expect(taskRuntime.planPath).toBe("docs/specs/feature-x/plan.md")
    expect(taskRuntime.taskContractPath).toBe("docs/specs/feature-x/state/tasks/task-5/task-contract.json")
  })

  test("task runtime resolves the correct write target from a multi-project prompt", async () => {
    const repoA = path.join(tempRoot, "repo-a")
    const repoB = path.join(tempRoot, "repo-b")
    mkdirSync(path.join(repoA, ".git"), { recursive: true })
    mkdirSync(path.join(repoA, "docs", "specs", "feature-x"), { recursive: true })
    mkdirSync(path.join(repoB, ".git"), { recursive: true })
    mkdirSync(path.join(repoB, "docs", "specs", "feature-x", "state", "tasks", "task-2"), { recursive: true })
    writeFileSync(path.join(repoA, "docs", "specs", "feature-x", "plan.md"), markdownPlanTask({ action: "Plan repo A task.", done: "Repo A task is planned." }), "utf-8")
    writeFileSync(path.join(repoB, "docs", "specs", "feature-x", "plan.md"), markdownPlanTask({ id: "2", action: "Plan repo B task.", done: "Repo B task is planned." }), "utf-8")
    writeFileSync(
      path.join(tempRoot, ".opencode", "state", "active-plan.json"),
      JSON.stringify({
        slug: "feature-x",
        writeTargets: [
          {
            project: "repo-a",
            targetRepoRoot: repoA,
            planPath: "docs/specs/feature-x/plan.md",
            specPath: "docs/specs/feature-x/spec.md",
            contextPath: "docs/specs/feature-x/CONTEXT.md",
          },
          {
            project: "repo-b",
            targetRepoRoot: repoB,
            planPath: "docs/specs/feature-x/plan.md",
            specPath: "docs/specs/feature-x/spec.md",
            contextPath: "docs/specs/feature-x/CONTEXT.md",
          },
        ],
      }, null, 2) + "\n",
      "utf-8"
    )

    const harness = await createHarness(["j.task-runtime.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-multi-target", callID: "1" },
      {
        args: {
          prompt:
            `Execute task 2\nTarget Repo Root: ${repoB}\nPlan: docs/specs/feature-x/plan.md\nSpec: docs/specs/feature-x/spec.md\nContext: docs/specs/feature-x/CONTEXT.md`,
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-multi-target",
        info: {
          parentID: "parent-multi-target",
          title: "Execute task 2",
        },
      },
    })

    const taskRuntimePath = path.join(repoB, "docs", "specs", "feature-x", "state", "tasks", "task-2", "runtime.json")
    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      targetRepoRoot: string
      planPath: string
      specPath: string
      contextPath: string
    }

    expect(taskRuntime.targetRepoRoot).toBe(repoB)
    expect(taskRuntime.planPath).toBe("docs/specs/feature-x/plan.md")
    expect(taskRuntime.specPath).toBe("docs/specs/feature-x/spec.md")
    expect(taskRuntime.contextPath).toBe("docs/specs/feature-x/CONTEXT.md")
  })

  test("task runtime preserves compatibility fields while binding child sessions", async () => {
    const harness = await createHarness(["j.task-runtime.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-compat", callID: "1" },
      {
        args: {
          prompt: "Validate task 4 for docs/specs/feature-x/plan.md\nAttempt: 2\nStage: validate",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-compat",
        info: {
          parentID: "parent-compat",
          title: "Validate task 4",
        },
      },
    })

    const taskRuntimePath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-4", "runtime.json")
    const taskRuntime = JSON.parse(readFileSync(taskRuntimePath, "utf-8")) as {
      taskId: number
      taskID: string
      attempt: number
      stage: string
      branch: string
      planBranch: string
      sessionId: string
      ownerSessionID: string
      startedAt?: string
      lastHeartbeat?: string
    }

    expect(taskRuntime.taskId).toBe(4)
    expect(taskRuntime.taskID).toBe("4")
    expect(taskRuntime.attempt).toBe(2)
    expect(taskRuntime.stage).toBe("validate")
    expect(taskRuntime.branch).toBe("feature/feature-x")
    expect(taskRuntime.planBranch).toBe("feature/feature-x")
    expect(taskRuntime.sessionId).toBe("child-compat")
    expect(taskRuntime.ownerSessionID).toBe("child-compat")
    expect(typeof taskRuntime.startedAt).toBe("string")
    expect(typeof taskRuntime.lastHeartbeat).toBe("string")
  })

  test("task runtime watchdog retries stale sessions once and records retry metadata", async () => {
    const createdCalls: Array<{ directory?: string; parentID?: string; title?: string }> = []
    const promptCalls: Array<{ sessionID: string; directory?: string; agent?: string; parts?: Array<{ type: string; text?: string }> }> = []
    const abortCalls: Array<{ sessionID: string; directory?: string }> = []
    const mockClient: MockSessionClient = {
      session: {
        status: async () => ({ data: { "child-stale": { type: "idle" } } }),
        abort: async (args) => {
          abortCalls.push(args)
          return { data: true }
        },
        delete: async () => ({ data: true }),
        create: async (args) => {
          createdCalls.push(args)
          return { data: { id: "retry-session-1" } }
        },
        promptAsync: async (args) => {
          promptCalls.push(args)
          return { data: undefined }
        },
      },
    }

    const harness = await createHarness(["j.task-runtime.ts"], { client: mockClient })

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-stale", callID: "1" },
      {
        args: {
          prompt: "Validate task 6 for docs/specs/feature-x/plan.md\nAttempt: 1\nStage: validate",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-stale",
        info: {
          parentID: "parent-stale",
          title: "Validate task 6",
        },
      },
    })

    const taskDir = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-6")
    writeFileSync(
      path.join(taskDir, "execution-state.md"),
      [
        "# Task 6 — Execution State",
        "",
        "- **Status**: IN_PROGRESS",
        "- **Feature slug**: feature-x",
        "- **Wave**: 1",
        "- **Attempt**: 1",
        "- **Branch**: feature/feature-x",
        "- **Started at**: 2026-04-14T00:00:00.000Z",
        "- **Last heartbeat**: 2026-04-14T00:00:00.000Z",
        "- **Depends on**: None",
        "- **Retry of**: None",
        "",
        "## Files Modified",
        "- None yet.",
      ].join("\n"),
      "utf-8"
    )

    const runtimePath = path.join(taskDir, "runtime.json")
    const runtime = JSON.parse(readFileSync(runtimePath, "utf-8")) as Record<string, unknown>
    writeFileSync(
      runtimePath,
      JSON.stringify(
        {
          ...runtime,
          lastHeartbeat: "2026-04-14T00:00:00.000Z",
        },
        null,
        2
      ) + "\n",
      "utf-8"
    )

    await harness.runEvent({
      type: "session.status",
      properties: {
        sessionID: "child-stale",
        status: { type: "idle" },
      },
    })

    expect(abortCalls).toHaveLength(1)
    expect(abortCalls[0]).toEqual({ sessionID: "child-stale", directory: tempRoot })
    expect(createdCalls).toHaveLength(1)
    expect(createdCalls[0]?.parentID).toBe("parent-stale")
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.sessionID).toBe("retry-session-1")
    expect(promptCalls[0]?.agent).toBe("j.validator")
    expect(promptCalls[0]?.parts?.[0]?.text).toContain("Attempt: 2")
    expect(promptCalls[0]?.parts?.[0]?.text).toContain("Retry reason: stale-validator-session")

    const retryState = JSON.parse(readFileSync(path.join(taskDir, "retry-state.json"), "utf-8")) as {
      attempt: number
      automaticRetriesUsed: number
      lastReason?: string
      abortedSessionId?: string
      retriedFromAttempt?: number
    }
    expect(retryState.attempt).toBe(2)
    expect(retryState.automaticRetriesUsed).toBe(1)
    expect(retryState.lastReason).toBe("stale-validator-session")
    expect(retryState.abortedSessionId).toBe("child-stale")
    expect(retryState.retriedFromAttempt).toBe(1)

    const taskRuntime = JSON.parse(readFileSync(path.join(taskDir, "runtime.json"), "utf-8")) as {
      attempt: number
      sessionId: string
      ownerSessionID: string
      status?: string
    }
    expect(taskRuntime.attempt).toBe(2)
    expect(taskRuntime.sessionId).toBe("retry-session-1")
    expect(taskRuntime.ownerSessionID).toBe("retry-session-1")
    expect(taskRuntime.status).toBeUndefined()

    const staleSessionRuntime = JSON.parse(
      readFileSync(path.join(tempRoot, "docs", "specs", "feature-x", "state", "sessions", "child-stale-runtime.json"), "utf-8")
    ) as { status?: string; sessionId?: string; ownerSessionID?: string }
    expect(staleSessionRuntime.status).toBe("SUPERSEDED")
    expect(staleSessionRuntime.sessionId).toBe("child-stale")
    expect(staleSessionRuntime.ownerSessionID).toBe("child-stale")

    const retriedSessionRuntime = JSON.parse(
      readFileSync(path.join(tempRoot, "docs", "specs", "feature-x", "state", "sessions", "retry-session-1-runtime.json"), "utf-8")
    ) as { attempt: number; ownerSessionID: string }
    expect(retriedSessionRuntime.attempt).toBe(2)
    expect(retriedSessionRuntime.ownerSessionID).toBe("retry-session-1")

    const taskContract = JSON.parse(readFileSync(path.join(taskDir, "task-contract.json"), "utf-8")) as {
      attempt: number
      ownerSessionID?: string
    }
    expect(taskContract.attempt).toBe(2)
    expect(taskContract.ownerSessionID).toBe("retry-session-1")
  })

  test("task runtime inherits workspace watchdog disabled config for child repos", async () => {
    const projectRoot = path.join(tempRoot, "nested", "child-repo")
    mkdirSync(path.join(projectRoot, ".git"), { recursive: true })
    mkdirSync(path.join(projectRoot, "docs", "specs", "feature-x"), { recursive: true })
    writeFileSync(
      path.join(projectRoot, "docs", "specs", "feature-x", "plan.md"),
      markdownPlanTask({ action: "Implement child repo task.", done: "Child repo task complete." }),
      "utf-8"
    )
    writeFileSync(
      path.join(tempRoot, ".opencode", "juninho-config.json"),
      JSON.stringify({ workflow: { implement: { watchdogSessionStale: false } } }, null, 2) + "\n",
      "utf-8"
    )

    const createCalls: Array<unknown> = []
    const mockClient: MockSessionClient = {
      session: {
        status: async () => ({ data: { "child-disabled": { type: "idle" } } }),
        abort: async () => ({ data: true }),
        delete: async () => ({ data: true }),
        create: async (args) => {
          createCalls.push(args)
          return { data: { id: "should-not-create" } }
        },
        promptAsync: async () => ({ data: undefined }),
      },
    }

    const harness = await createHarness(["j.task-runtime.ts"], { client: mockClient, directory: projectRoot })

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-disabled", callID: "1" },
      {
        args: {
          prompt: `Execute task 5 for docs/specs/feature-x/plan.md\nTarget Repo Root: ${projectRoot}`,
        },
      }
    )
    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-disabled",
        info: { parentID: "parent-disabled", title: "Execute task 5" },
      },
    })
    await harness.runEvent({
      type: "session.status",
      properties: { sessionID: "child-disabled", status: { type: "idle" } },
    })

    expect(createCalls).toHaveLength(0)
  })

  test("task runtime classifies execute-task prompts as implement despite validator artifact paths", async () => {
    const createdCalls: Array<{ directory?: string; parentID?: string; title?: string }> = []
    const promptCalls: Array<{ sessionID: string; parts?: Array<{ type: string; text?: string }> }> = []
    const mockClient: MockSessionClient = {
      session: {
        status: async () => ({ data: { "child-implement": { type: "idle" } } }),
        abort: async () => ({ data: true }),
        delete: async () => ({ data: true }),
        create: async (args) => {
          createdCalls.push(args)
          return { data: { id: "retry-implement-1" } }
        },
        promptAsync: async (args) => {
          promptCalls.push(args)
          return { data: undefined }
        },
      },
    }

    const harness = await createHarness(["j.task-runtime.ts"], { client: mockClient })

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-implement", callID: "1" },
      {
        args: {
          prompt: "Execute task 5 for feature feature-x.\nvalidatorWorkPath: /tmp/docs/specs/feature-x/state/tasks/task-5/validator-work.md",
        },
      }
    )
    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-implement",
        info: { parentID: "parent-implement", title: "Execute task 5" },
      },
    })

    const taskDir = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-5")
    writeFileSync(
      path.join(taskDir, "execution-state.md"),
      [
        "# Task 5 — Execution State",
        "",
        "- **Status**: IN_PROGRESS",
        "- **Feature slug**: feature-x",
        "- **Wave**: 1",
        "- **Attempt**: 1",
        "- **Branch**: feature/feature-x",
        "- **Started at**: 2026-04-14T00:00:00.000Z",
        "- **Last heartbeat**: 2026-04-14T00:00:00.000Z",
        "- **Depends on**: None",
      ].join("\n"),
      "utf-8"
    )
    const runtimePath = path.join(taskDir, "runtime.json")
    const runtime = JSON.parse(readFileSync(runtimePath, "utf-8")) as Record<string, unknown>
    writeFileSync(runtimePath, JSON.stringify({ ...runtime, lastHeartbeat: "2026-04-14T00:00:00.000Z" }, null, 2) + "\n", "utf-8")

    await harness.runEvent({
      type: "session.status",
      properties: { sessionID: "child-implement", status: { type: "idle" } },
    })

    expect(createdCalls).toHaveLength(1)
    expect(promptCalls[0]?.parts?.[0]?.text).toContain("Stage: implement")
    expect(promptCalls[0]?.parts?.[0]?.text).toContain("Retry reason: stale-task-session")
  })

  test("task runtime does not relaunch retry when stale session abort fails", async () => {
    const createCalls: Array<unknown> = []
    const mockClient: MockSessionClient = {
      session: {
        status: async () => ({ data: { "child-abort-fails": { type: "idle" } } }),
        abort: async () => {
          throw new Error("abort unavailable")
        },
        delete: async () => {
          throw new Error("delete unavailable")
        },
        create: async (args) => {
          createCalls.push(args)
          return { data: { id: "should-not-run" } }
        },
        promptAsync: async () => ({ data: undefined }),
      },
    }

    const harness = await createHarness(["j.task-runtime.ts"], { client: mockClient })

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-abort-fails", callID: "1" },
      { args: { prompt: "Execute task 9 for docs/specs/feature-x/plan.md" } }
    )
    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-abort-fails",
        info: { parentID: "parent-abort-fails", title: "Execute task 9" },
      },
    })

    const taskDir = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-9")
    writeFileSync(
      path.join(taskDir, "execution-state.md"),
      [
        "# Task 9 — Execution State",
        "",
        "- **Status**: IN_PROGRESS",
        "- **Feature slug**: feature-x",
        "- **Wave**: 1",
        "- **Attempt**: 1",
        "- **Branch**: feature/feature-x",
        "- **Started at**: 2026-04-14T00:00:00.000Z",
        "- **Last heartbeat**: 2026-04-14T00:00:00.000Z",
        "- **Depends on**: None",
      ].join("\n"),
      "utf-8"
    )
    const runtimePath = path.join(taskDir, "runtime.json")
    const runtime = JSON.parse(readFileSync(runtimePath, "utf-8")) as Record<string, unknown>
    writeFileSync(runtimePath, JSON.stringify({ ...runtime, lastHeartbeat: "2026-04-14T00:00:00.000Z" }, null, 2) + "\n", "utf-8")

    await harness.runEvent({
      type: "session.status",
      properties: { sessionID: "child-abort-fails", status: { type: "idle" } },
    })

    expect(createCalls).toHaveLength(0)
    const retryState = JSON.parse(readFileSync(path.join(taskDir, "retry-state.json"), "utf-8")) as { automaticRetriesUsed: number; attempt: number }
    expect(retryState.automaticRetriesUsed).toBe(0)
    expect(retryState.attempt).toBe(1)
  })

  test("task runtime watchdog respects retry budget after one automatic retry", async () => {
    const createCalls: Array<unknown> = []
    const mockClient: MockSessionClient = {
      session: {
        status: async () => ({ data: { "child-budget": { type: "idle" } } }),
        abort: async () => ({ data: true }),
        delete: async () => ({ data: true }),
        create: async (args) => {
          createCalls.push(args)
          return { data: { id: "should-not-run" } }
        },
        promptAsync: async () => ({ data: undefined }),
      },
    }

    const harness = await createHarness(["j.task-runtime.ts"], { client: mockClient })

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-budget", callID: "1" },
      {
        args: {
          prompt: "Execute task 8 for docs/specs/feature-x/plan.md\nAttempt: 1",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-budget",
        info: {
          parentID: "parent-budget",
          title: "Execute task 8",
        },
      },
    })

    const taskDir = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-8")
    writeFileSync(
      path.join(taskDir, "execution-state.md"),
      [
        "# Task 8 — Execution State",
        "",
        "- **Status**: IN_PROGRESS",
        "- **Feature slug**: feature-x",
        "- **Wave**: 1",
        "- **Attempt**: 1",
        "- **Branch**: feature/feature-x",
        "- **Started at**: 2026-04-14T00:00:00.000Z",
        "- **Last heartbeat**: 2026-04-14T00:00:00.000Z",
        "- **Depends on**: None",
        "- **Retry of**: None",
      ].join("\n"),
      "utf-8"
    )
    writeFileSync(
      path.join(taskDir, "retry-state.json"),
      JSON.stringify({
        taskId: 8,
        attempt: 1,
        automaticRetriesUsed: 1,
        lastUpdatedAt: "2026-04-14T00:01:00.000Z",
      }, null, 2) + "\n",
      "utf-8"
    )

    await harness.runEvent({
      type: "session.status",
      properties: {
        sessionID: "child-budget",
        status: { type: "idle" },
      },
    })

    expect(createCalls).toHaveLength(0)
    const retryState = JSON.parse(readFileSync(path.join(taskDir, "retry-state.json"), "utf-8")) as {
      automaticRetriesUsed: number
      attempt: number
    }
    expect(retryState.automaticRetriesUsed).toBe(1)
    expect(retryState.attempt).toBe(1)
  })

  test("carl startup seed prefers explicit task contract over prompt wording", async () => {
    writeFileSync(path.join(tempRoot, "docs", "specs", "feature-x", "spec.md"), "# Spec\ncontract spec marker\n", "utf-8")
    writeFileSync(path.join(tempRoot, "docs", "specs", "feature-x", "CONTEXT.md"), "# Context\ncontract context marker\n", "utf-8")
    writeActivePlan(tempRoot, "docs/specs/feature-x/plan.md")

    const contractPath = path.join(tempRoot, "docs", "specs", "feature-x", "state", "tasks", "task-1", "task-contract.json")
    mkdirSync(path.dirname(contractPath), { recursive: true })
    writeFileSync(
      contractPath,
      JSON.stringify(
        {
          featureSlug: "feature-x",
          taskID: "1",
          planPath: "docs/specs/feature-x/plan.md",
          specPath: "docs/specs/feature-x/spec.md",
          contextPath: "docs/specs/feature-x/CONTEXT.md",
          taskContractPath: "docs/specs/feature-x/state/tasks/task-1/task-contract.json",
        },
        null,
        2
      ) + "\n",
      "utf-8"
    )

    const harness = await createHarness(["j.carl-inject.ts"])

    await harness.runToolBefore(
      { tool: "Task", sessionID: "parent-carl-contract", callID: "1" },
      {
        args: {
          subagent_type: "j.implementer",
          prompt: "Ambiguous prompt with no reliable feature wording.",
          task_contract_path: "docs/specs/feature-x/state/tasks/task-1/task-contract.json",
        },
      }
    )

    await harness.runEvent({
      type: "session.created",
      properties: {
        sessionID: "child-carl-contract",
        info: {
          parentID: "parent-carl-contract",
          title: "contract seeded child",
        },
      },
    })

    const startupOutput = { message: {}, parts: [] as unknown[] }
    await harness.runChatMessage({ sessionID: "child-carl-contract" }, startupOutput)

    const system = typeof startupOutput.message.system === "string" ? startupOutput.message.system : ""
    expect(system).toContain("[carl-inject] Delegated session startup context")
    expect(system).toContain("# Payment Patterns")
    expect(system).toContain("ORDER-DOMAIN-MARKER")
    expect(system).not.toContain("CASHOUT-DISTRACTOR")
  })
})
