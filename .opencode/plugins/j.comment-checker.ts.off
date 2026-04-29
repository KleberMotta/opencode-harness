import type { Plugin } from "@opencode-ai/plugin"

// Detects obvious/redundant comments after Write/Edit and appends a reminder.
// Uses tool.execute.after — appends to output.output so agent sees the warning.

const OBVIOUS_PATTERNS = [
  /\/\/ increment .*/i,
  /\/\/ set .* to/i,
  /\/\/ return .*/i,
  /\/\/ call .*/i,
  /\/\/ create .* variable/i,
  /\/\/ check if/i,
  /\/\/ loop (through|over|for)/i,
  /\/\/ define function/i,
  /\/\/ initialize/i,
  /\/\/ assign/i,
]

const IGNORE_PATTERNS = [
  /\/\/\s*@ts-/,
  /\/\/\s*eslint/,
  /\/\/\s*TODO/i,
  /\/\/\s*FIXME/i,
  /\/\/\s*HACK/i,
  /\/\/\s*NOTE:/i,
  /\/\/\s*BUG:/i,
  /\/\*\*/,
  /\s*\*\s/,
  /given|when|then/i,
  /describe|it\(/,
]

function hasObviousComments(content: string): string[] {
  const lines = content.split("\n")
  const found: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (IGNORE_PATTERNS.some((p) => p.test(line))) continue
    if (OBVIOUS_PATTERNS.some((p) => p.test(line))) {
      found.push(`Line ${i + 1}: ${line.trim()}`)
    }
  }

  return found
}

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.after": async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any }
  ) => {
    if (!["Write", "Edit"].includes(input.tool)) return

    const content: string = input.args?.content ?? input.args?.new_string ?? ""
    if (!content) return

    const obvious = hasObviousComments(content)
    if (obvious.length === 0) return

    output.output +=
      `\n\n[comment-checker] ${obvious.length} potentially obvious comment(s) detected:\n` +
      obvious.slice(0, 3).join("\n") +
      `\nConsider removing redundant comments — code should be self-documenting.`
  },
})) satisfies Plugin
