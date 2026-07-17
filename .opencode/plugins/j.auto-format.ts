import type { Plugin } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import path from "path"
import { argFilePath, toolIs } from "../lib/j.tool-compat"

// Auto-formats files after Write/Edit tool calls.
// Real API: tool.execute.after(input, output) — input.args has the file path.

const FORMATTERS: Record<string, string> = {
  ".ts": "prettier --write",
  ".tsx": "prettier --write",
  ".js": "prettier --write",
  ".jsx": "prettier --write",
  ".json": "prettier --write",
  ".css": "prettier --write",
  ".scss": "prettier --write",
  ".md": "prettier --write",
  ".py": "black",
  ".go": "gofmt -w",
  ".rs": "rustfmt",
}

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.after": async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    _output: { title: string; output: string; metadata: any }
  ) => {
    if (!toolIs(input.tool, "write", "edit")) return

    const filePath = argFilePath(input.args)
    if (!filePath) return

    const formatter = FORMATTERS[path.extname(filePath)]
    if (!formatter) return

    try {
      execSync(`${formatter} "${filePath}"`, { stdio: "ignore" })
    } catch {
      // Formatter not available — skip silently
    }
  },
})) satisfies Plugin
