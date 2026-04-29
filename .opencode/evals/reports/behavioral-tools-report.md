# OpenCode Behavioral Eval Report

- Tasks: 3
- Passed: 3/3

## Task 1

- Question: Use the `find_pattern` tool with `patternType=service` and answer only `tool=find_pattern` if it succeeds without tool error.
- Preferred tool: find-pattern_find_pattern
- Preferred tool used: yes
- Tool calls: 1
- Duration: 13.87s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-e6UYQO/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-e6UYQO
- Orchestrator feedback: <none>
- Expected answer: tool=find_pattern
- Actual answer: tool=find_pattern
- Answer match: yes
```json
{
  "find-pattern_find_pattern": {
    "count": 1,
    "durationsMs": [
      4
    ]
  }
}
```

## Task 2

- Question: Use the `next_version` tool with `type=migration` and answer only `tool=next_version:0002` if it returns the expected next version.
- Preferred tool: next-version_next_version
- Preferred tool used: yes
- Tool calls: 1
- Duration: 15.63s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-omcIKa/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-omcIKa
- Orchestrator feedback: <none>
- Expected answer: tool=next_version:0002
- Actual answer: tool=next_version:0002
- Answer match: yes
```json
{
  "next-version_next_version": {
    "count": 1,
    "durationsMs": [
      3
    ]
  }
}
```

## Task 3

- Question: Use the `lsp_document_symbols` tool on `src/main/kotlin/Foo.kt` and answer only `tool=lsp_document_symbols:Foo,bar` if it returns those first two symbols.
- Preferred tool: lsp_lsp_document_symbols
- Preferred tool used: yes
- Tool calls: 1
- Duration: 13.97s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-Pkblci/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-Pkblci
- Orchestrator feedback: <none>
- Expected answer: tool=lsp_document_symbols:Foo,bar
- Actual answer: tool=lsp_document_symbols:Foo,bar
- Answer match: yes
```json
{
  "lsp_lsp_document_symbols": {
    "count": 1,
    "durationsMs": [
      4
    ]
  }
}
```

