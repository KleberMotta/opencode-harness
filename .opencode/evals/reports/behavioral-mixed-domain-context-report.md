# OpenCode Behavioral Eval Report

- Tasks: 1
- Passed: 1/1

## Task 1

- Question: Use the Task tool with a subagent and ask it to execute task 1 from the active plan for an order settlement workflow change. Tell it to inspect its startup context only and reply exactly `mixed-domain-context=ready` if and only if the startup context already includes both the `PRINCIPLE-SUBAGENT-MARKER` principle marker and the `Marker: DOMAIN-SANDBOX-MARKER` order-domain marker, while not including `MESSAGING-DISTRACTOR-MARKER`. Then answer only with the subagent result.
- Preferred tool: task
- Preferred tool used: yes
- Tool calls: 1
- Duration: 24.18s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-Hyqi62/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-Hyqi62
- Orchestrator feedback: <none>
- Expected answer: mixed-domain-context=ready
- Actual answer: mixed-domain-context=ready
- Answer match: yes
```json
{
  "task": {
    "count": 1,
    "durationsMs": [
      5566
    ]
  }
}
```

