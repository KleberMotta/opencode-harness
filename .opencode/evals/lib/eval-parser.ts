import { readFileSync } from "fs"

export interface EvalTask {
  question: string
  answer?: string
  preferredTool?: string
  maxToolCalls?: number
  maxDurationMs?: number
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))
  const value = match?.[1]?.trim()
  return value && value.length > 0 ? value : undefined
}

export function parseEvaluationXml(xml: string): EvalTask[] {
  const matches = xml.matchAll(/<qa_pair>([\s\S]*?)<\/qa_pair>/g)
  const tasks: EvalTask[] = []

  for (const match of matches) {
    const block = match[1]
    const question = extractTag(block, "question")
    if (!question) continue

    const answer = extractTag(block, "answer")
    const preferredTool = extractTag(block, "preferred_tool")
    const maxToolCallsRaw = extractTag(block, "max_tool_calls")
    const maxDurationMsRaw = extractTag(block, "max_duration_ms")

    tasks.push({
      question,
      answer,
      preferredTool,
      maxToolCalls:
        maxToolCallsRaw && Number.isFinite(Number(maxToolCallsRaw)) ? Number(maxToolCallsRaw) : undefined,
      maxDurationMs:
        maxDurationMsRaw && Number.isFinite(Number(maxDurationMsRaw)) ? Number(maxDurationMsRaw) : undefined,
    })
  }

  return tasks
}

export function parseEvaluationFile(filePath: string): EvalTask[] {
  return parseEvaluationXml(readFileSync(filePath, "utf-8"))
}
