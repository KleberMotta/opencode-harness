import type { Plugin } from "@opencode-ai/plugin"
import crypto from "crypto"

// Tags each line in Read output with NN#XX: prefix for stable hash references.
// Agent uses these tags when editing — hashline-edit.ts validates them.
// Uses tool.execute.after — sets output.output to the tagged version.

function hashLine(line: string): string {
  return crypto.createHash("md5").update(line).digest("hex").slice(0, 2)
}

function addHashlines(content: string): string {
  return content
    .split("\n")
    .map((line, i) => {
      const lineNum = String(i + 1).padStart(3, "0")
      const hash = hashLine(line)
      return `${lineNum}#${hash}: ${line}`
    })
    .join("\n")
}

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.after": async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any }
  ) => {
    if (input.tool !== "Read") return
    if (typeof output.output !== "string") return

    output.output = addHashlines(output.output)
  },
})) satisfies Plugin
