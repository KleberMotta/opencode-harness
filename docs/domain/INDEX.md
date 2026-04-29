# Domain Index

Global index of business domain documentation.

Serves two purposes:
1. **CARL lookup table** — `j.carl-inject.ts` reads `Keywords:` lines to match prompt words and inject the listed `Files:`
2. **Planner orientation** — `@j.planner` reads this before interviewing to know what domain knowledge exists

Run `/j.finish-setup` to auto-populate from the codebase.
Update manually as you document business domains.

---

## Format

Each entry:
```
## {domain}
Keywords: keyword1, keyword2, keyword3
Files:
  - {domain}/rules.md — Core business rules
  - {domain}/limits.md — Limits, thresholds, quotas
  - {domain}/edge-cases.md — Known edge cases and expected behavior
```

---

## (no domains yet)

Run `/j.finish-setup` to scan the codebase and generate initial domain entries.

Add entries manually as you document business rules:

```
## payments
Keywords: payment, stripe, checkout, invoice, subscription, billing, charge
Files:
  - payments/rules.md — Core payment processing rules
  - payments/edge-cases.md — Failed payments, retries, refunds
```

---

*Planner reads this index before interviewing to know what domain knowledge exists.*
*carl-inject reads `Keywords:` lines to match prompt words and inject `Files:` entries.*
*UNIFY updates this file after each feature that touches a documented domain.*
