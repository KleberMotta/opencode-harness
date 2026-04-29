#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const layer = process.argv[2] || "all"

const layerFiles = {
  all: [
    "./evals/tests/structural/harness-structure.test.ts",
    "./evals/tests/hooks/commit-scripts.test.ts",
    "./evals/tests/context/plugin-context.test.ts",
    "./evals/tests/state/feature-integration.test.ts",
  ],
  structural: ["./evals/tests/structural/harness-structure.test.ts"],
  hooks: ["./evals/tests/hooks/commit-scripts.test.ts"],
  context: ["./evals/tests/context/plugin-context.test.ts"],
  state: ["./evals/tests/state/feature-integration.test.ts"],
}

const files = layerFiles[layer]
if (!files) {
  console.error(`Unknown eval layer: ${layer}`)
  process.exit(1)
}

const result = spawnSync("bun", ["test", ...files], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
})

process.exit(result.status ?? 1)
