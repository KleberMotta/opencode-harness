import type { Plugin } from "@opencode-ai/plugin"

// Blocks reads/writes of sensitive files before any tool executes.
// Real API: tool.execute.before(input, output) — throw Error to abort.

const SENSITIVE = [
  /\.env($|\.)/i,
  /secret/i,
  /credential/i,
  /\.pem$/i,
  /id_rsa/i,
  /\.key$/i,
]

export default (async ({ directory: _directory }: { directory: string }) => ({
  "tool.execute.before": async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any }
  ) => {
    const filePath: string =
      output.args?.path ?? output.args?.file_path ?? output.args?.filename ?? ""
    if (!filePath) return

    if (SENSITIVE.some((p) => p.test(filePath))) {
      throw new Error(
        `[env-protection] Blocked access to sensitive file: ${filePath}\n` +
        `If intentional, temporarily disable the env-protection plugin.`
      )
    }
  },
})) satisfies Plugin
