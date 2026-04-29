# OpenCode Behavioral Eval Report

- Tasks: 3
- Passed: 3/3

## Task 1

- Question: Use the read tool on `src/feature/SampleController.kt`. If the harness surfaces any matching file-type guidance or skill hint for this controller file, load that guidance before answering. Then answer exactly `markers: SRC-SANDBOX-MARKER, CONTROLLER-SKILL-MARKER` only when both the nested AGENTS marker and the controller skill marker are available to you.
- Preferred tool: read
- Preferred tool used: yes
- Tool calls: 2
- Duration: 15.87s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-BuSTHR/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-BuSTHR
- Orchestrator feedback: Reading the controller file and loading the matching controller guidance before answering.
- Expected answer: markers: SRC-SANDBOX-MARKER, CONTROLLER-SKILL-MARKER
- Actual answer: Reading the controller file and loading the matching controller guidance before answering.

markers: SRC-SANDBOX-MARKER, CONTROLLER-SKILL-MARKER
- Answer match: yes
```json
{
  "read": {
    "count": 1,
    "durationsMs": [
      18
    ]
  },
  "skill": {
    "count": 1,
    "durationsMs": [
      36
    ]
  }
}
```

## Task 2

- Question: Use the Task tool with a subagent. Ask that subagent to execute task 1 from the active plan for `src/feature/SampleController.kt` in the payment settlement workflow and report exactly `subagent-markers: PRINCIPLE-SUBAGENT-MARKER, DOMAIN-SUBAGENT-MARKER` only if both docs from `docs/principles` and `docs/domain` are visible to it through the harness context flow. Then answer only with the subagent result.
- Preferred tool: task
- Preferred tool used: yes
- Tool calls: 1
- Duration: 921.19s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-VTR5VS/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-VTR5VS
- Orchestrator feedback: <none>
- Expected answer: subagent-markers: PRINCIPLE-SUBAGENT-MARKER, DOMAIN-SUBAGENT-MARKER
- Actual answer: subagent-markers: PRINCIPLE-SUBAGENT-MARKER, DOMAIN-SUBAGENT-MARKER
- Answer match: yes
```json
{
  "task": {
    "count": 1,
    "durationsMs": [
      904414
    ]
  }
}
```

## Task 3

- Question: Read `src/feature/SampleController.kt` and answer exactly `markers: PLAN-SANDBOX-MARKER, MEMORY-SANDBOX-MARKER` if the injected context includes the active plan marker and the persistent memory marker.
- Preferred tool: read
- Preferred tool used: yes
- Tool calls: 1
- Duration: 28.96s
- Transcript: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-DQqWDo/eval-output.jsonl
- Sandbox: /var/folders/0n/65lbp6zs0yv8wyxwwb10p07r0000gn/T/juninho-behavioral-DQqWDo
- Orchestrator feedback: <none>
- Expected answer: markers: PLAN-SANDBOX-MARKER, MEMORY-SANDBOX-MARKER
- Actual answer: markers: PLAN-SANDBOX-MARKER, MEMORY-SANDBOX-MARKER
- Answer match: yes
```json
{
  "read": {
    "count": 1,
    "durationsMs": [
      16
    ]
  }
}
```

