import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"

// Injects persistent-context.md (cross-session repo memory, like OpenClaw).
// This file is written by UNIFY and contains project conventions, decisions,
// and patterns accumulated across sessions.
// Two hooks:
//   tool.execute.after — injects on the FIRST tool call of a session so the
//     agent has repo memory from the very beginning.
//   experimental.session.compacting — re-injects during compaction so memory
//     survives context window resets.

function loadMemory(directory: string): string | null {
  const memoryPath = path.join(directory, ".opencode", "state", "persistent-context.md")
  if (!existsSync(memoryPath)) return null

  const content = readFileSync(memoryPath, "utf-8").trim()
  if (!content) return null

  return content
}

export default (async ({ directory }: { directory: string }) => {
  const injectedSessions = new Set<string>()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      // Fire once per session — first tool call triggers injection
      if (injectedSessions.has(input.sessionID)) return
      injectedSessions.add(input.sessionID)

      const memory = loadMemory(directory)
      if (!memory) return

      output.output +=
        `\n\n[memory] Project memory (persistent-context):\n\n${memory}`
    },
    "experimental.session.compacting": async (
      _input: Record<string, unknown>,
      output: { context: string[]; prompt?: string }
    ) => {
      const memory = loadMemory(directory)
      if (!memory) return

      output.context.push(
        `[memory] Project memory (persistent-context):\n\n${memory}`
      )
    },
  }
}) satisfies Plugin
