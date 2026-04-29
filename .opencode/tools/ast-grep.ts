import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "child_process"

function runAstGrep(args: string): { output: string; error?: string } {
  try {
    const output = execSync(`ast-grep ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return { output }
  } catch (e: any) {
    if (e.code === "ENOENT" || e.message?.includes("not found")) {
      return { output: "", error: "ast-grep not installed. Run: npm install -g @ast-grep/cli" }
    }
    return { output: e.stdout ?? "", error: e.stderr ?? e.message }
  }
}

export const ast_grep_search = tool({
  name: "ast_grep_search",
  description: "Search for code patterns using AST matching. More precise than text search. Use meta-variables: $NAME (single node), $$$ARGS (multiple nodes).",
  parameters: z.object({
    pattern: z.string().describe("AST pattern with meta-variables. E.g.: 'console.log($MSG)', 'function $NAME($$$ARGS)'"),
    language: z.enum(["typescript", "javascript", "tsx", "python", "rust", "go", "java", "kotlin"]).default("typescript"),
    path: z.string().optional().describe("Directory or file to search (defaults to current directory)"),
    maxResults: z.number().optional().default(20),
  }),
  execute: async ({ pattern, language, path: searchPath, maxResults }) => {
    const pathArg = searchPath ? `--dir "${searchPath}"` : ""
    const { output, error } = runAstGrep(`scan --pattern '${pattern}' --lang ${language} ${pathArg} --json`)

    if (error) return { error, pattern }

    try {
      const results = JSON.parse(output || "[]")
      return {
        pattern,
        language,
        matches: results.slice(0, maxResults),
        total: results.length,
      }
    } catch {
      return { pattern, output: output.slice(0, 2000) }
    }
  },
})

export const ast_grep_replace = tool({
  name: "ast_grep_replace",
  description: "Replace code patterns using AST matching. Use meta-variables in both pattern and replacement.",
  parameters: z.object({
    pattern: z.string().describe("Pattern to match (use meta-variables like $NAME, $$$ARGS)"),
    replacement: z.string().describe("Replacement pattern (use same meta-variables)"),
    language: z.enum(["typescript", "javascript", "tsx", "python", "rust", "go", "java", "kotlin"]).default("typescript"),
    path: z.string().optional().describe("Directory or file to transform"),
    dryRun: z.boolean().optional().default(true).describe("Preview changes without applying (default: true)"),
  }),
  execute: async ({ pattern, replacement, language, path: targetPath, dryRun }) => {
    const pathArg = targetPath ? `--dir "${targetPath}"` : ""
    const dryRunArg = dryRun ? "--dry-run" : ""

    const { output, error } = runAstGrep(
      `scan --pattern '${pattern}' --rewrite '${replacement}' --lang ${language} ${pathArg} ${dryRunArg}`
    )

    if (error) return { error, pattern, replacement }

    return {
      pattern,
      replacement,
      dryRun,
      output: output.slice(0, 3000),
      note: dryRun ? "Dry run — no files modified. Set dryRun: false to apply changes." : "Changes applied.",
    }
  },
})
