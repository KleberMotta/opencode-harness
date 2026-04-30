/**
 * model-list.ts — Show current model tiers from juninho-config.json
 *
 * Usage:
 *   bun .opencode/cli/model-list.ts
 *   npm run model:list
 */
import { readFileSync } from "fs"
import path from "path"

function main() {
  const root = path.resolve(import.meta.dir, "../..")
  const configPath = path.join(root, "juninho-config.json")

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    const models = config.models ?? {}

    console.log("Model tiers (juninho-config.json):")
    console.log(`  strong : ${models.strong ?? "(not set)"}`)
    console.log(`  medium : ${models.medium ?? "(not set)"}`)
    console.log(`  weak   : ${models.weak ?? "(not set)"}`)
  } catch (e: any) {
    console.error(`Failed to read config: ${e.message}`)
    process.exit(1)
  }
}

main()
