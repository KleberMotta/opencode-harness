#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const suites = {
  smoke: [
    ["eval:behavioral:subagent-context", "behavioral subagent context"],
    ["eval:behavioral:implement-loop", "behavioral implement loop"],
    ["eval:behavioral:check-loop", "behavioral check loop"],
    ["eval:behavioral:unify-loop", "behavioral unify loop"],
  ],
  context: [
    ["eval:behavioral:context", "behavioral context"],
    ["eval:behavioral:subagent-context", "behavioral subagent context"],
    ["eval:behavioral:mixed-domain-context", "behavioral mixed-domain context"],
    ["eval:behavioral:dual-domain-context", "behavioral dual-domain context"],
    ["eval:behavioral:cashout-balance-context", "behavioral cashout-balance context"],
    ["eval:behavioral:checker-startup", "behavioral checker startup"],
    ["eval:behavioral:planner-startup", "behavioral planner startup"],
    ["eval:behavioral:spec-startup", "behavioral spec startup"],
  ],
  workflow: [
    ["eval:behavioral:implement-loop", "behavioral implement loop"],
    ["eval:behavioral:check-loop", "behavioral check loop"],
    ["eval:behavioral:unify-loop", "behavioral unify loop"],
  ],
  tools: [
    ["eval:behavioral:tools", "behavioral tools"],
    ["eval:behavioral:commit", "behavioral commit"],
    ["eval:behavioral:skill-effect", "behavioral skill-effect"],
  ],
  full: [
    ["eval:behavioral:context", "behavioral context"],
    ["eval:behavioral:tools", "behavioral tools"],
    ["eval:behavioral:commit", "behavioral commit"],
    ["eval:behavioral:skill-effect", "behavioral skill-effect"],
    ["eval:behavioral:subagent-context", "behavioral subagent context"],
    ["eval:behavioral:mixed-domain-context", "behavioral mixed-domain context"],
    ["eval:behavioral:dual-domain-context", "behavioral dual-domain context"],
    ["eval:behavioral:cashout-balance-context", "behavioral cashout-balance context"],
    ["eval:behavioral:implement-loop", "behavioral implement loop"],
    ["eval:behavioral:check-loop", "behavioral check loop"],
    ["eval:behavioral:unify-loop", "behavioral unify loop"],
    ["eval:behavioral:checker-startup", "behavioral checker startup"],
    ["eval:behavioral:planner-startup", "behavioral planner startup"],
    ["eval:behavioral:spec-startup", "behavioral spec startup"],
  ],
}

const impactSuitesByArea = {
  carl: "context",
  context: "context",
  runtime: "context",
  workflow: "workflow",
  implement: "workflow",
  check: "workflow",
  unify: "workflow",
  tools: "tools",
  skill: "tools",
}

const requestedSuite = process.argv[2] || "smoke"
const requestedArea = process.argv[3] || ""
const resolvedSuite = requestedSuite === "impact" ? impactSuitesByArea[requestedArea] : requestedSuite
const steps = resolvedSuite ? suites[resolvedSuite] : undefined

if (!steps) {
  if (requestedSuite === "impact") {
    console.error(`[behavioral-runner] Unknown impact area: ${requestedArea}`)
  } else {
    console.error(`[behavioral-runner] Unknown suite: ${requestedSuite}`)
  }
  process.exit(1)
}

for (const [script, label] of steps) {
  console.log(`\n[behavioral-runner] Starting ${label}`)
  const result = spawnSync("bun", ["run", script], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  })

  if ((result.status ?? 1) !== 0) {
    console.error(`[behavioral-runner] Failed during ${label}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`\n[behavioral-runner] Suite '${requestedSuite === "impact" ? `impact:${requestedArea}` : requestedSuite}' passed`)
