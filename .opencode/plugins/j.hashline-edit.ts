import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import crypto from "crypto"

// Validates hashline references before Edit tool calls.
// Throws an Error (aborts the edit) if referenced hashes are stale.
// Uses tool.execute.before — output.args has the edit arguments.

function hashLine(line: string): string {
  return crypto.createHash("md5").update(line).digest("hex").slice(0, 2)
}

const HASHLINE_REF = /^(\d{3})#([a-f0-9]{2}):/

function extractHashlineRefs(text: string): Array<{ lineNum: number; hash: string }> {
  return text
    .split("\n")
    .map((line) => {
      const match = HASHLINE_REF.exec(line)
      if (!match) return null
      return { lineNum: parseInt(match[1], 10), hash: match[2] }
    })
    .filter((r): r is { lineNum: number; hash: string } => r !== null)
}

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.before": async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any }
  ) => {
    if (input.tool !== "Edit") return

    const filePath: string = output.args?.path ?? output.args?.file_path ?? ""
    const oldString: string = output.args?.old_string ?? ""

    if (!filePath || !oldString || !existsSync(filePath)) return

    const refs = extractHashlineRefs(oldString)
    if (refs.length === 0) return

    const currentLines = readFileSync(filePath, "utf-8").split("\n")

    for (const ref of refs) {
      const lineIndex = ref.lineNum - 1
      if (lineIndex >= currentLines.length) {
        throw new Error(
          `[hashline-edit] Stale reference: line ${ref.lineNum} no longer exists in ${filePath}.\n` +
          `Re-read the file to get current hashlines.`
        )
      }

      const currentHash = hashLine(currentLines[lineIndex])
      if (currentHash !== ref.hash) {
        throw new Error(
          `[hashline-edit] Stale reference at line ${ref.lineNum}: expected hash ${ref.hash}, got ${currentHash}.\n` +
          `Re-read the file to get current hashlines.`
        )
      }
    }
  },
})) satisfies Plugin
