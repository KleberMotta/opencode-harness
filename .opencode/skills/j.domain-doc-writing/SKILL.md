---
name: j.domain-doc-writing
description: Write docs/domain business docs and INDEX.md entries in the exact format j.carl-inject parses, so the doc actually reaches the agent
---

# Skill: Domain Doc Writing

## When this skill activates
Creating or editing any file under `docs/domain/`, including `docs/domain/INDEX.md`.

## Required Steps

1. **Write the doc against the code, not against memory.** Open the services, entities, and controllers that own the flow and describe what they do now. `docs/domain/*` answers *what the business does*; `AGENTS.md` answers *how to work in this directory*; `docs/principles/*` answers *which technical pattern applies across modules*.

2. **Use the section set from the canon.** `/Users/kleber.motta/repos/contexts/trp/trp-financial-api/docs/domain/cashout.md`: `Resumo do dominio` → `Fontes de verdade` (the code paths that justify the doc) → `Entradas e saidas` (per entrypoint: endpoint, headers, payload, failures, result) → then the domain's states, limits, and edge cases. Write in the language the repo's docs already use.

3. **Register the doc in `docs/domain/INDEX.md` in the exact parsed format.** `parseDomainIndex` in `/Users/kleber.motta/repos/.opencode/plugins/j.carl-inject.ts` is the only thing that turns a file on disk into an injected doc:

   ```ts
   const sections = content.split(/^## /m).slice(1)
   const domain = lines[0].trim()
   const keywordsLine = lines.find((line) => line.startsWith("Keywords:"))
   const filesStart = lines.findIndex((line) => line.startsWith("Files:"))
   if (!keywordsLine || filesStart === -1) continue
   const fileMatch = /^\s*-\s+([^—]+)(?:—\s+(.*))?$/.exec(lines[index])
   if (!fileMatch) break
   ```

   What that code demands, literally:
   - `## {domain}` — heading at column 0. The split is on `^## ` with no code-fence stripping.
   - `Keywords:` — column 0, capital `K`, no bold, no leading spaces. `startsWith` means `**Keywords:**` or a two-space indent does not match, and the whole section is then **dropped silently** (`continue`).
   - `Files:` — same literal rule. Missing it drops the section too.
   - Bullets start on the very next line after `Files:`. The loop `break`s on the first line that fails the bullet regex, so one blank line or one sentence between `Files:` and the bullets truncates the list.
   - The separator between path and description is an **em-dash `—` (U+2014)**. `([^—]+)` captures everything up to it; with a plain hyphen the path becomes `cashout.md - Cashout domain` and resolves to nothing.
   - Keywords are lowercased, then filtered against `GENERIC_CARL_KEYWORDS` (`api`, `controller`, `endpoint`, `handler`, `http`, `integration`, `mock`, `request`, `response`, `rest`, `route`, `spec`, `test`, `tests`, `unit`). Keywords that survive the filter are the only ones that can ever match a prompt.

4. **Pick keywords that are the domain's own vocabulary, in every language the team types.** The canon's `cashout` entry recalls on `cashout, saque, repasse, transfer`; `accounting` recalls on `accounting, contabil, contabilidade, lancamento, fechamento, close-day, period-close, ...`. None of them is a word from the generic list, and each is a word someone would actually type in a task.

5. **Add sync markers that name the code, and know what they are worth.** `<!-- juninho:sync source=... hash=... -->` is read by `/Users/kleber.motta/repos/.opencode/commands/j.sync-docs.md` as a human/agent pointer during a refresh. No plugin parses it — grep `juninho:sync` across `.opencode/` and the only hits are this skill, the principle skill, and that command. So: `source=` is the load-bearing half (it is checkable — the path exists or it does not), and `hash=` is a free-text label, not a content hash. The docs on disk carry `hash=finish`, `hash=manual`, `hash=scan`, `hash=fix`, and short hex strings, and nothing recomputes or validates any of them. Write `source=` with a real path; use `hash=` to say who last touched it (`manual`) and never rely on it to detect drift.

## Canonical Example

The pair that makes `cashout.md` reachable. `/Users/kleber.motta/repos/contexts/trp/trp-financial-api/docs/domain/INDEX.md`:

```markdown
## cashout
Keywords: cashout, saque, repasse, transfer
Files:
  - cashout.md — Cashout and transfer domain
```

And the head of `/Users/kleber.motta/repos/contexts/trp/trp-financial-api/docs/domain/cashout.md` it points at:

```markdown
<!-- juninho:sync source=src/main/kotlin/br/com/olx/trp/financial/domain/cashout/service/CashoutCreateService.kt hash=manual -->
<!-- juninho:sync source=src/main/kotlin/br/com/olx/trp/financial/domain/cashout/service/CashoutService.kt hash=manual -->

# Cashout

## Resumo do dominio

Cashout e o fluxo de saque do seller. Ele retira um valor do saldo `AVAILABLE`, reserva esse valor em `CASHOUT` e depois envia a instrucao de transferencia para o parceiro externo. O ciclo pode comecar manualmente pela API de cashout ou automaticamente a partir da liberacao de uma order.

O identificador publico do cashout e o `idempotenceId`. Ele e gerado como UUID, fica salvo na entidade e passa a ser a referencia usada em consulta, cancelamento, eventos e integracao com o parceiro.

## Fontes de verdade

- `src/main/kotlin/br/com/olx/trp/financial/domain/cashout/service/CashoutCreateService.kt`
- `src/main/kotlin/br/com/olx/trp/financial/domain/cashout/persistence/entity/CashoutEntity.kt`
- `src/main/kotlin/br/com/olx/trp/financial/web/controller/cashout/CashoutController.kt`

## Entradas e saidas

### Criacao manual

- Endpoint: `POST /v1/cashouts`
- Contexto do seller: header `OLX_ACCOUNT_ID`
- Payload obrigatorio: `bankAccountId` e `amount`
- Header opcional: `X-trp-bypass-sfa` (Boolean, default `false`) — quando `true`, a criacao manual ignora o bloqueio por `authenticationBlocked`
- Falha com `403 Forbidden` quando o seller esta com `authenticationBlocked = true`, exceto quando `X-trp-bypass-sfa = true`
```

Every rule there is falsifiable against a named file: the status names, the header names, the default, and the failure code are all things a reader can check in `CashoutController.kt` and be wrong about out loud.

## RED_LINES

- **Never ship a domain doc without its INDEX entry.** A file in `docs/domain/` that no `## {domain}` section lists is never injected by CARL — it is a file nobody reads, and it rots without anyone noticing.
- **Never indent, bold, or rename the `Keywords:` and `Files:` labels.** The parser uses `startsWith` on the raw line; a section that fails either check is dropped with no error, no warning, and no log. The doc looks registered and is not.
- **Never separate a path from its description with anything but an em-dash `—`.** `([^—]+)` swallows the hyphen version whole, so the path silently becomes garbage while the entry still "parses".
- **Never build an INDEX entry out of the generic keywords.** `api`, `endpoint`, `request`, `response`, `test`, and the rest of `GENERIC_CARL_KEYWORDS` are stripped before matching. An entry whose keywords are all generic has an empty effective keyword list and can never fire — the same failure that leaves `api-patterns.md` in the registered manifests reachable only through the word `next`.
- **Never put a `## ` heading at column 0 inside a fenced example block in INDEX.md.** `parseDomainIndex` splits on `^## ` without stripping fences. The `## Format` template in the canon's own INDEX files does exactly this: the illustrative `## {domain}` inside the fence is parsed as a live domain entry with keywords `keyword1, keyword2, keyword3` and files `{domain}/rules.md` that do not exist. Indent the example inside the fence.
- **Never leave a blank line or prose between `Files:` and the first bullet.** The file loop `break`s on the first non-matching line, so every bullet after the gap is dropped while the entry still registers.
- **Never trust `hash=` to tell you the doc is current.** Nothing computes it and nothing checks it. If you need to know whether the doc still matches the code, re-read the file named in `source=`.
- **Never document a proposal as behavior.** `docs/domain/` is implemented truth; intent belongs in the context's `knowledge/drafts/`.

## Anti-patterns to avoid

- Explaining framework internals (JPA, Spring wiring, SQS plumbing) instead of business behavior — that is `docs/principles/` territory.
- Pasting code into the doc instead of naming the file under `Fontes de verdade`.
- Vague rules with no identifiers: "the cashout is validated" instead of the status, the header, and the failure code.
- Keywords chosen from the doc's own prose instead of from the words a developer would type in a task.
- One giant `INDEX.md` entry listing every file in the domain — CARL injects what you list, so listing everything means injecting everything.
- Adding a sync marker with a `source=` path that no longer exists, which makes the doc look verified while pointing at nothing.

## Mimicry Test

1. Run the INDEX section through the real parser (`parseDomainIndex` in `j.carl-inject.ts`) and confirm your domain appears, with the files you expect and a non-empty keyword list after the generic filter is applied.
2. Type the task you would actually type ("ajustar o agendamento do saque") and confirm at least one of your keywords appears in it.
3. Hand the doc alone to an agent and ask it to state the failure case for the flow — it should answer with the real status and code, and be checkable against the file in `source=`.
4. Change one business rule in the code and confirm exactly one place in the doc goes stale — if several do, the doc is repeating itself.
