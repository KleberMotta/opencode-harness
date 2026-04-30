#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const layer = process.argv[2] || "all"

const layerFiles = {
  all: [
    "./.opencode/evals/tests/structural/harness-structure.test.ts",
    "./.opencode/evals/tests/hooks/commit-scripts.test.ts",
    "./.opencode/evals/tests/context/plugin-context.test.ts",
    "./.opencode/evals/tests/state/feature-integration.test.ts",
  ],
  structural: ["./.opencode/evals/tests/structural/harness-structure.test.ts"],
  hooks: ["./.opencode/evals/tests/hooks/commit-scripts.test.ts"],
  context: ["./.opencode/evals/tests/context/plugin-context.test.ts"],
  state: ["./.opencode/evals/tests/state/feature-integration.test.ts"],
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
