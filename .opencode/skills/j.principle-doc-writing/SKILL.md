---
name: j.principle-doc-writing
description: Write docs/principles docs and manifest entries in the exact format j.carl-inject parses, with keywords that survive the generic filter
---

# Skill: Principle Doc Writing

## When this skill activates
Creating or editing any file under `docs/principles/`, including `docs/principles/manifest`.

## Required Steps

1. **Write the principle from this repo's code.** A principle doc captures a cross-cutting technical pattern several modules already follow. If you cannot name three files in this repo that follow it, you are writing a preference, not a principle. Business rules go to `docs/domain/*`; directory-local working rules go to that directory's `AGENTS.md`.

2. **Use the section set from the canon.** `contexts/trp/trp-financial-api/docs/principles/async-messaging-patterns.md`: a one-paragraph statement of the pattern → `Problem this principle solves` → `Rule set` → `Rationale and trade-offs` → `Canonical examples in this repository` (real paths, one line each saying what each proves).

3. **Register the doc in `docs/principles/manifest` in the exact parsed format.** `parsePrinciplesManifest` in `.opencode/plugins/j.carl-inject.ts` is the only thing that turns a file on disk into an injected principle:

   ```ts
   const lines = content.split("\n").filter((line) => !line.startsWith("#") && line.trim())
   const match = /^([A-Z_]+)_(STATE|RECALL|FILE|PRIORITY|ALWAYS)=(.*)$/.exec(line)
   if (fields["STATE"] !== "active") continue
   if (!fields["FILE"]) continue
   recall: fields["RECALL"].split(",").map((k) => k.trim().toLowerCase()).filter(Boolean)
   priority: parseInt(fields["PRIORITY"] ?? "50", 10)
   always: /^(1|true|yes)$/i.test(fields["ALWAYS"] ?? "false")
   ```

   The entry format, field by field:

   | Field | Rule enforced by the code |
   |---|---|
   | `{KEY}_STATE` | Must be exactly `active` — the comparison is `!== "active"`, so `Active` or `enabled` drops the entry |
   | `{KEY}_RECALL` | Comma-separated keywords, lowercased and trimmed; then filtered against `GENERIC_CARL_KEYWORDS` |
   | `{KEY}_FILE` | Required. No `_FILE`, no entry. Path relative to the repo, e.g. `docs/principles/auth-patterns.md` |
   | `{KEY}_PRIORITY` | Optional integer, defaults to `50` |
   | `{KEY}_ALWAYS` | Optional; only `1`, `true`, or `yes` count as true — injects regardless of keyword match |

   `{KEY}` must match `[A-Z_]+`: uppercase and underscores only. A key with a digit or a lowercase letter never matches the regex, so every field under it is invisible. Lines starting with `#` are dropped first, so comments are safe.

4. **Choose `_RECALL` keywords that survive the filter.** Before matching, every keyword is filtered through `GENERIC_CARL_KEYWORDS`:

   ```ts
   const GENERIC_CARL_KEYWORDS = new Set([
     "api", "controller", "endpoint", "handler", "http", "integration", "mock",
     "request", "response", "rest", "route", "spec", "test", "tests", "unit",
   ])
   ...
   return recall.filter((keyword) => !GENERIC_CARL_KEYWORDS.has(keyword))
   ```

   Pick words that are this repo's own vocabulary and that a developer would type in a real task: `sqs`, `sns`, `idempotence`, `flyway`, `spotless`, `escrow`, `repasse`. A keyword that is generic is deleted; a keyword that is short and common is worse than deleted — see the RED_LINES.

5. **Verify the entry fires before you call it done.** Run the doc's keywords against the real parser and confirm the effective list is non-empty and made of words from your task vocabulary.

## Canonical Example

A registered, repo-specific principle. The manifest entry format, from `contexts/trp/trp-financial-api/docs/principles/manifest`:

```
AUTH_STATE=active
AUTH_RECALL=auth, authentication, login, logout, session, token, jwt, oauth, clerk, middleware
AUTH_FILE=docs/principles/auth-patterns.md
```

And the doc worth pointing at — the head of `contexts/trp/trp-financial-api/docs/principles/async-messaging-patterns.md`:

```markdown
<!-- juninho:sync source=src/main/kotlin/br/com/olx/trp/financial/messaging/MessagingService.kt hash=manual -->

# Async Messaging Patterns

The application uses SQS and SNS as workflow handoff boundaries. The messaging layer stays thin and contract-driven so replayed events do not create new business behavior.

## Problem this principle solves

Async order, inactive-fee, and cashout flows depend on exact queue keys, topic keys, event types, and payload shapes. If these contracts drift, consumers can silently stop processing or process the wrong transition.

## Rule set

- Publish through `MessagingService`; do not create ad-hoc queue or topic clients in business flows.
- Resolve infrastructure names from logical keys stored in typed configuration.
- Keep listeners thin: log useful context, delegate once, and let domain services own state transitions.
- Preserve trace and event attributes needed for downstream correlation.
- Make consumers safe for duplicate or replayed delivery.

## Rationale and trade-offs

- Logical keys decouple code from environment-specific names, but missing configuration fails at runtime rather than compile time.
- Thin listeners make business logic easier to test in domain services, but they require strong event contracts and good logging.

## Canonical examples in this repository

- `src/main/kotlin/br/com/olx/trp/financial/messaging/MessagingService.kt` is the single publish entry point for queue, topic, and event dispatch.
- `src/main/kotlin/br/com/olx/trp/financial/messaging/configuration/QueuesTopicsConfiguration.kt` maps logical keys to runtime names and fails fast on missing keys.
- `src/main/kotlin/br/com/olx/trp/financial/listener/order/OrderOrchestratorListeners.kt` shows the listener-as-adapter pattern for queue-driven orchestration.
```

Every rule names the class that enforces it, and every trade-off names what it costs. That is the bar.

Now read that file's real defect: it is **not in the manifest**. Neither are `financial-workflow-patterns.md`, `migration-patterns.md`, or `runtime-configuration-patterns.md` in that same directory. The four repo-specific, hand-written principles in `trp-financial-api` are unreachable, while the five that *are* registered are the untouched boilerplate. Writing the doc is half the job; the manifest entry is the other half.

## RED_LINES

- **Never ship a principle without its manifest entry.** `async-messaging-patterns.md`, `financial-workflow-patterns.md`, `migration-patterns.md`, and `runtime-configuration-patterns.md` are the best principle docs in `trp-financial-api` and no agent has ever seen one: no `_FILE` points at them, so CARL never injects them. An unregistered principle is a file nobody reads.
- **Never build a `_RECALL` out of generic keywords.** `API_RECALL=api, route, endpoint, handler, request, response, next, http, rest` — the entry registered in all five of `trp-financial-api`, `trp-partner-api`, `trp-seller-api`, `usermod-anti-fraud`, and `sf-backoffice` — reduces to exactly one surviving keyword after the filter: `next`. So `api-patterns.md` never loads when someone types "add an endpoint", and always loads when someone types "next task". The entry looks well-configured and is inverted.
- **Never use a short, common word as a keyword.** `next` matches "next task", "next step", "next commit" — every prompt in the loop. The principle becomes noise, and noise trains agents to skim injected context. A keyword must be a word that is only typed when the principle is relevant.
- **Never copy the stub.** `docs/principles/auth-patterns.md` is byte-identical across `trp-financial-api`, `trp-partner-api`, `trp-seller-api`, `usermod-anti-fraud`, and `sf-backoffice` — same file, five repos with five different auth stacks. Boilerplate that survives because nobody reads it is the dominant failure mode here. If the doc would be true in any repo, it is worth nothing in this one.
- **Never write `_STATE` as anything but the literal `active`.** The check is `fields["STATE"] !== "active"`; `Active`, `ACTIVE`, and `enabled` drop the entry silently, with no error and no log.
- **Never use a `{KEY}` outside `[A-Z_]`.** The regex is `^([A-Z_]+)_(STATE|RECALL|FILE|PRIORITY|ALWAYS)=(.*)$`. A key like `Api2` matches nothing, so every field under it is skipped and the principle never registers.
- **Never point `_FILE` at a path that does not exist.** Nothing fails loudly — the entry parses, the injection finds no file, and the principle is silently absent.
- **Never set `_ALWAYS=true` to force a weak principle into every prompt.** `_ALWAYS` bypasses keyword matching entirely and spends context on every single turn. Earn the injection with keywords instead.

## Anti-patterns to avoid

- Restating business requirements — statuses, amounts, and payloads belong in `docs/domain/*`.
- Slogans with no enforcement: "handle errors properly" with no rule, no file, and no trade-off.
- Rules with no named class or config to check them against.
- A `Rationale and trade-offs` section that lists only benefits — if the pattern costs nothing, it is not a trade-off, and the reader cannot tell when to break the rule.
- Documenting an obsolete pattern without marking it deprecated, so agents keep reproducing it.
- Registering a doc under a `{KEY}` that duplicates an existing one — the later fields overwrite the earlier under the same prefix in `byKey`.

## Mimicry Test

1. Run your manifest entry through the real parser (`parsePrinciplesManifest` in `j.carl-inject.ts`) and confirm the entry appears, that `_FILE` resolves to a real path, and that the effective keyword list is non-empty after the generic filter.
2. Write down three real tasks that should load this principle and three that should not. Your keywords must hit all three of the first and none of the second.
3. Delete the repo name from the doc's heading and read it: if it would still be true in a different repo, it is a stub — rewrite it against this codebase.
4. Ask an agent to apply the principle using only the doc. It should be able to name the class to call and the mistake to avoid, without opening the tree.
