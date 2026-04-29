import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { existsSync, readdirSync } from "fs"
import path from "path"

export const next_version = tool({
  name: "next_version",
  description: "Get the next version number for migrations or schema files",
  parameters: z.object({
    type: z.enum(["migration", "schema"]).describe("Type of versioned file"),
    cwd: z.string().optional().describe("Working directory"),
  }),
  execute: async ({ type, cwd: cwdInput }) => {
    const cwd = cwdInput ?? process.cwd()

    const migrationDirs = ["prisma/migrations","db/migrations","migrations","drizzle"]
    const schemaDirs = ["prisma", "db", "src/db", "src/main/resources"]

    const dirs = type === "migration" ? migrationDirs : schemaDirs

    for (const dir of dirs) {
      const fullDir = path.join(cwd, dir)
      if (!existsSync(fullDir)) continue

      const entries = readdirSync(fullDir)
        .filter((e) => /^\d/.test(e))
        .sort()

      if (entries.length === 0) {
        return { nextVersion: "0001", dir: fullDir, existing: [] }
      }

      const lastEntry = entries[entries.length - 1]
      const match = /^(\d+)/.exec(lastEntry)
      if (!match) continue

      const lastNum = parseInt(match[1], 10)
      const nextNum = String(lastNum + 1).padStart(match[1].length, "0")

      return {
        nextVersion: nextNum,
        dir: fullDir,
        existing: entries.slice(-3),
        lastEntry,
      }
    }

    return {
      nextVersion: "0001",
      dir: "migrations/",
      existing: [],
      note: "No migration directory found. Create one first.",
    }
  },
})
