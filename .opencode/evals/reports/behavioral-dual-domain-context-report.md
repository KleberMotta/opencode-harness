# OpenCode Behavioral Eval Report

- Tasks: 1
- Passed: 1/1

## Task 1

- Question: Use the Task tool with a subagent and ask it to execute task 1 from the active plan for a cashout batch-processing change. It should answer exactly `dual-domain-context=ready` only if the startup context gives it both the cashout workflow guidance and the batch-processing guidance it needs, without also injecting bank-account guidance that is only adjacent context. Then answer only with the subagent result.
- Preferred tool: task
- Preferred tool used: yes
- Tool calls: 1
- Duration: 27.98s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-eqvvg2/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-eqvvg2
- Orchestrator feedback: <none>
- Expected answer: dual-domain-context=ready
- Actual answer: dual-domain-context=ready
- Answer match: yes
```json
{
  "task": {
    "count": 1,
    "durationsMs": [
      9637
    ]
  }
}
```

