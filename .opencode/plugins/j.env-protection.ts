import type { Plugin } from "@opencode-ai/plugin"
import { argFilePath } from "../lib/j.tool-compat"

// Blocks reads/writes of sensitive files before any tool executes.
// Real API: tool.execute.before(input, output) — throw Error to abort.

// Filename-based patterns only. Broad path substrings like /secret/ or
// /credential/ block legitimate files in Java/K8s target repos
// (application-secrets.yml, k8s secret manifests, credentials mappers).
const SENSITIVE = [
  /(^|\/)\.env($|\.(?!example$))/i,
  /\.pem$/i,
  /(^|\/)id_rsa[^/]*$/i,
  /\.key$/i,
]

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.before": async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any }
  ) => {
    const filePath = argFilePath(output.args)
    if (!filePath) return

    if (SENSITIVE.some((p) => p.test(filePath))) {
      throw new Error(
        `[env-protection] Blocked access to sensitive file: ${filePath}\n` +
        `If intentional, temporarily disable the env-protection plugin.`
      )
    }
  },
})) satisfies Plugin
