import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { createSkillMapResolver, resolveSkillPath } from "../lib/j.skill-map"
import { argFilePaths, toolIs } from "../lib/j.tool-compat"

// Injects skill instructions via tool.execute.after on Read + Write.
//
// The resolution rule (merged skill-map, regex compilation, SKILL.md lookup)
// lives in ../lib/j.skill-map.ts so that `bun run skills:coverage` audits the
// exact same behaviour this plugin executes at runtime.

export default (async ({ directory }: { directory: string }) => {
  const injectedSkills = new Set<string>()
  const getSkillMap = createSkillMapResolver(directory)

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      if (!toolIs(input.tool, "write", "edit", "apply_patch")) return
      for (const filePath of argFilePaths(output.args)) {
        const matches = getSkillMap(filePath).filter(({ pattern }) => pattern.test(filePath))
        for (const match of matches) {
          const key = `${input.sessionID}:${match.skill}`
          if (injectedSkills.has(key)) continue
          throw new Error(
            `[skill-inject] READ_REQUIRED: before editing ${filePath}, read the existing target or load skill "${match.skill}" explicitly. The applicable file-pattern canon must be in context before the first write.`
          )
        }
      }
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (toolIs(input.tool, "skill")) {
        const skill = typeof input.args?.name === "string" ? input.args.name : ""
        if (skill) injectedSkills.add(`${input.sessionID}:${skill}`)
        return
      }
      const filePaths = argFilePaths(input.args)
      if (filePaths.length === 0) return

      if (toolIs(input.tool, "read")) {
        const injectedBlocks: string[] = []
        for (const filePath of filePaths) {
          const matches = getSkillMap(filePath).filter(({ pattern }) => pattern.test(filePath))
          for (const match of matches) {
            const key = `${input.sessionID}:${match.skill}`
            if (injectedSkills.has(key)) continue

            const skillPath = resolveSkillPath(directory, match.skill, filePath)
            if (!skillPath) continue

            injectedSkills.add(key)
            const skillContent = readFileSync(skillPath, "utf-8")
            injectedBlocks.push(`\n\n[skill-inject] Skill activated for ${match.skill} (${match.source}):\n\n${skillContent}`)
          }
        }
        if (injectedBlocks.length > 0) output.output += injectedBlocks.join("")
      }
    },
  }
}) satisfies Plugin
