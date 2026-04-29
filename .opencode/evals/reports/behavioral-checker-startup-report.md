# OpenCode Behavioral Eval Report

- Tasks: 1
- Passed: 1/1

## Task 1

- Question: Use the Task tool with subagent `j.checker`. Tell it to inspect its startup context only, before reading files, and reply exactly `checker-startup-context=ready` if and only if that startup context already includes `CHECKER-PRINCIPLE-MARKER`, `CHECKER-ORDERS-MARKER`, and `CHECKER-BALANCE-MARKER`, while not including `CHECKER-CASHOUT-DISTRACTOR`. Then answer only with the subagent result.
- Preferred tool: task
- Preferred tool used: yes
- Tool calls: 1
- Duration: 23.22s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-PE2E3d/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-PE2E3d
- Orchestrator feedback: <none>
- Expected answer: checker-startup-context=ready
- Actual answer: checker-startup-context=ready
- Answer match: yes
```json
{
  "task": {
    "count": 1,
    "durationsMs": [
      4959
    ]
  }
}
```

