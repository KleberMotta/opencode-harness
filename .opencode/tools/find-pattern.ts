import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { existsSync, readFileSync } from "fs"
import path from "path"

export const find_pattern = tool({
  name: "find_pattern",
  description: "Find canonical code patterns in the codebase for consistent implementation",
  parameters: z.object({
    patternType: z.string().describe("The type of pattern to find (e.g. api-route, service, repository, test-unit, error-handler)"),
    cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
  }),
  execute: async ({ patternType, cwd: cwdInput }) => {
    const cwd = cwdInput ?? process.cwd()
    const manifestPath = path.join(cwd, "docs", "principles", "manifest")

    if (existsSync(manifestPath)) {
      const manifest = readFileSync(manifestPath, "utf-8")
      const lines = manifest.split("\n")
      const section = lines
        .slice(lines.findIndex((l) => l.toLowerCase().includes(patternType)))
        .slice(0, 20)
        .join("\n")
      if (section.trim()) return { pattern: patternType, example: section }
    }

    // Fallback patterns
    const FALLBACK_PATTERNS: Record<string, string> = {
          "service": "// src/services/example.ts\nexport class ExampleService {\n  constructor(private readonly repository: ExampleRepository) {}\n\n  async findById(id: string): Promise<Example> {\n    const result = await this.repository.findById(id)\n    if (!result) throw new NotFoundError(`Example ${id} not found`)\n    return result\n  }\n}",
          "error-handler": "// src/middleware/error-handler.ts\nexport function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {\n  if (err instanceof NotFoundError) {\n    return res.status(404).json({ error: err.message })\n  }\n  console.error(err)\n  res.status(500).json({ error: \"Internal server error\" })\n}"
    }

    return {
      pattern: patternType,
      example: FALLBACK_PATTERNS[patternType] ?? "No canonical pattern found. Check docs/principles/manifest.",
    }
  },
})
