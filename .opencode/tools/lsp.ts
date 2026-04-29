import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { execSync } from "child_process"

// LSP tools — type checker and reference search
// Type checker: npx tsc --noEmit --pretty false

function runTypeCheck(cwd: string, args: string): string {
  try {
    return execSync(`npx tsc --noEmit --pretty false ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
  } catch (e: any) {
    return e.stdout ?? e.message ?? "type check failed"
  }
}

export const lsp_diagnostics = tool({
  name: "lsp_diagnostics",
  description: "Get diagnostics (errors and warnings) for a file or directory",
  parameters: z.object({
    path: z.string().describe("File or directory to check"),
    severity: z.enum(["error", "warning", "info"]).optional().default("error"),
  }),
  execute: async ({ path: targetPath, severity }) => {
    const output = runTypeCheck(process.cwd(), `2>&1 | grep "${targetPath}"`)
    const lines = output.split("\n").filter((l) => {
      if (severity === "error") return l.includes("error") || l.includes("ERROR")
      if (severity === "warning") return l.includes("warning") || l.includes("WARN")
      return l.trim().length > 0
    })
    return { diagnostics: lines, count: lines.length }
  },
})

export const lsp_goto_definition = tool({
  name: "lsp_goto_definition",
  description: "Find where a symbol is defined",
  parameters: z.object({
    file: z.string().describe("Source file path"),
    line: z.number().describe("Line number (1-indexed)"),
    character: z.number().describe("Character position (0-indexed)"),
  }),
  execute: async ({ file, line, character }) => {
    try {
      const content = require("fs").readFileSync(file, "utf-8")
      const lines = content.split("\n")
      const targetLine = lines[line - 1] ?? ""
      const before = targetLine.slice(0, character)
      const after = targetLine.slice(character)
      const symbolMatch = /[\w$]+$/.exec(before)
      const symbolEnd = /^[\w$]*/.exec(after)
      const symbol = (symbolMatch?.[0] ?? "") + (symbolEnd?.[0] ?? "")
      return { symbol, hint: `Search for 'export.*${symbol}|function ${symbol}|class ${symbol}|const ${symbol}|fun ${symbol}|def ${symbol}|func ${symbol}'` }
    } catch {
      return { error: "Could not read file" }
    }
  },
})

export const lsp_find_references = tool({
  name: "lsp_find_references",
  description: "Find all references to a symbol across the codebase",
  parameters: z.object({
    file: z.string(),
    line: z.number(),
    character: z.number(),
    includeDeclaration: z.boolean().optional().default(true),
  }),
  execute: async ({ file, line, character }) => {
    try {
      const content = require("fs").readFileSync(file, "utf-8")
      const lineContent = content.split("\n")[line - 1] ?? ""
      const before = lineContent.slice(0, character)
      const after = lineContent.slice(character)
      const symbol = (/[\w$]+$/.exec(before)?.[0] ?? "") + (/^[\w$]*/.exec(after)?.[0] ?? "")
      if (!symbol) return { error: "No symbol at position" }
      const result = execSync(
        `grep -rn --include="*.ts" --include="*.tsx" "${symbol}" .`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      )
      const refs = result.split("\n").filter(Boolean)
      return { symbol, references: refs.slice(0, 20), total: refs.length }
    } catch (e: any) {
      return { references: [], note: e.stdout ?? "No references found" }
    }
  },
})

export const lsp_document_symbols = tool({
  name: "lsp_document_symbols",
  description: "Get all symbols (functions, classes, variables) in a file",
  parameters: z.object({ file: z.string() }),
  execute: async ({ file }) => {
    try {
      const content = require("fs").readFileSync(file, "utf-8")
      const lines = content.split("\n")
      const symbols: Array<{ line: number; kind: string; name: string }> = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const patterns: Array<[RegExp, string]> = [
          [/^export\s+(async\s+)?function\s+(\w+)/, "function"],
          [/^export\s+(const|let|var)\s+(\w+)/, "variable"],
          [/^export\s+(default\s+)?class\s+(\w+)/, "class"],
          [/^export\s+(type|interface)\s+(\w+)/, "type"],
          [/^\s*fun\s+(\w+)/, "function"],
          [/^\s*class\s+(\w+)/, "class"],
          [/^\s*interface\s+(\w+)/, "interface"],
          [/^\s*data\s+class\s+(\w+)/, "class"],
          [/^\s*object\s+(\w+)/, "object"],
          [/^\s*def\s+(\w+)/, "function"],
          [/^\s*func\s+(\w+)/, "function"],
          [/^\s+(async\s+)?(\w+)\s*\(/, "method"],
        ]
        for (const [pattern, kind] of patterns) {
          const match = pattern.exec(line)
          if (match) {
            symbols.push({ line: i + 1, kind, name: match[match.length - 1] })
            break
          }
        }
      }
      return { file, symbols }
    } catch {
      return { error: "Could not read file" }
    }
  },
})

export const lsp_workspace_symbols = tool({
  name: "lsp_workspace_symbols",
  description: "Search for symbols by name across the entire workspace",
  parameters: z.object({
    query: z.string().describe("Symbol name or pattern to search"),
    file: z.string().optional().describe("Any file in workspace (for language server context)"),
  }),
  execute: async ({ query }) => {
    try {
      const result = execSync(
        `grep -rn --include="*.ts" --include="*.tsx" -E "export.*(function|class|const|interface|type|fun|def|func).*${query}" .`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      )
      return { query, matches: result.split("\n").filter(Boolean).slice(0, 15) }
    } catch (e: any) {
      return { query, matches: [], note: "No matches found" }
    }
  },
})

export const lsp_prepare_rename = tool({
  name: "lsp_prepare_rename",
  description: "Check if the symbol at the given position can be safely renamed.",
  parameters: z.object({
    file: z.string().describe("Source file path"),
    line: z.number().describe("Line number (1-indexed)"),
    character: z.number().describe("Character position (0-indexed)"),
  }),
  execute: async ({ file, line, character }) => {
    try {
      const content = require("fs").readFileSync(file, "utf-8")
      const lines = content.split("\n")
      const lineContent = lines[line - 1] ?? ""
      const before = lineContent.slice(0, character)
      const after = lineContent.slice(character)
      const symBefore = /[\w$]+$/.exec(before)?.[0] ?? ""
      const symAfter = /^[\w$]*/.exec(after)?.[0] ?? ""
      const symbol = symBefore + symAfter

      if (!symbol) {
        return { canRename: false, reason: "No symbol at the given position" }
      }

      const KEYWORDS = new Set(["const", "let", "var", "function", "class", "import", "export", "return", "if", "else", "for", "while", "fun", "val", "def", "func", "package", "object", "data"])
      if (KEYWORDS.has(symbol)) {
        return { canRename: false, reason: `'${symbol}' is a language keyword` }
      }

      return {
        canRename: true,
        symbol,
        range: {
          start: { line, character: character - symBefore.length },
          end: { line, character: character + symAfter.length },
        },
        hint: "Call lsp_rename with newName to apply the rename across the workspace.",
      }
    } catch {
      return { canRename: false, reason: "Could not read file" }
    }
  },
})

export const lsp_rename = tool({
  name: "lsp_rename",
  description: "Preview rename of a symbol across all files (dry-run only — apply with sed/Edit)",
  parameters: z.object({
    file: z.string(),
    line: z.number(),
    character: z.number(),
    newName: z.string(),
  }),
  execute: async ({ file, line, character, newName }) => {
    try {
      const content = require("fs").readFileSync(file, "utf-8")
      const lineContent = content.split("\n")[line - 1] ?? ""
      const before = lineContent.slice(0, character)
      const after = lineContent.slice(character)
      const oldName = (/[\w$]+$/.exec(before)?.[0] ?? "") + (/^[\w$]*/.exec(after)?.[0] ?? "")
      if (!oldName) return { error: "No symbol at position" }

      const result = execSync(
        `grep -rln --include="*.ts" --include="*.tsx" "\\b${oldName}\\b" .`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      )
      const files = result.split("\n").filter(Boolean)
      return {
        oldName,
        newName,
        affectedFiles: files,
        command: `grep -rl "\\b${oldName}\\b" . | xargs sed -i 's/\\b${oldName}\\b/${newName}/g'`,
        note: "This is a preview. Run the command above to apply the rename.",
      }
    } catch (e: any) {
      return { error: e.message }
    }
  },
})
