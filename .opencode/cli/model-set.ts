/**
 * model-set.ts — Update model for a tier (strong/medium/weak) in
 * juninho-config.json, then regenerate opencode.json from template.
 *
 * Usage:
 *   bun .opencode/cli/model-set.ts <tier> <model-id>
 *   npm run model:set -- strong github-copilot/claude-opus-4.7
 */
import { readFileSync, writeFileSync } from "fs"
import { execSync } from "child_process"
import path from "path"

const VALID_TIERS = ["strong", "medium", "weak"]

function main() {
  const [tier, model] = process.argv.slice(2)

  if (!tier || !model) {
    console.error("Usage: model-set <tier> <model-id>")
    console.error("  tier: strong | medium | weak")
    console.error("  model-id: e.g. github-copilot/claude-opus-4.7")
    process.exit(1)
  }

  if (!VALID_TIERS.includes(tier)) {
    console.error(`Unknown tier: ${tier}. Must be: strong, medium, weak`)
    process.exit(1)
  }

  const root = path.resolve(import.meta.dir, "../..")
  const configPath = path.join(root, "juninho-config.json")

  // 1. Update juninho-config.json (source of truth)
  const config = JSON.parse(readFileSync(configPath, "utf-8"))
  if (!config.models) config.models = {}
  config.models[tier] = model
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  console.log(`✓ juninho-config.json: models.${tier} = ${model}`)

  // 2. Regenerate opencode.json from template
  execSync("bun .opencode/cli/sync-config.ts", { cwd: root, stdio: "inherit" })
}

main()
