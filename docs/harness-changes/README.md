# harness-changes — audit trail de mutações do harness

Este diretório é o registro permanente de toda mudança feita no harness via `/j.learn` (padrão Self-Harness). O harness nunca se auto-modifica silenciosamente: cada mutação nasce de uma falha observada, passa pelo gate de regressão, é aprovada por um humano e deixa um registro aqui.

## Nomenclatura

Um arquivo por proposta, numerado sequencialmente:

```
docs/harness-changes/NNN-<slug>.md    # ex.: 001-dto-immutability-lint-rule.md
```

`NNN` é o próximo número livre (zero-padded). Propostas rejeitadas ou dry-run também podem ser registradas — evidência de rejeição evita repropor a mesma ideia ruim.

## Formato: change contract

Cada registro contém o change contract completo (escrito ANTES de aplicar a mudança), o resultado das evals e a decisão final:

| Campo | Significado |
| --- | --- |
| `surface` | A única superfície alterada (agent, command, plugin, script, skill, skill-map, AGENTS do contexto ou lint-rules do contexto). Exatamente 1 falha → exatamente 1 superfície. |
| `failure_mechanism` | O mecanismo raiz da falha (não o sintoma), em uma frase. |
| `evidence` | Ponteiros/trechos verbatim: diff da correção do dev, trecho de check-review.md, trace de sessão. Obrigatório — proposta sem failure pattern é rejeitada. |
| `expected_effect` | Que comportamento observável muda com a alteração. |
| `preserved_invariants` | O que NÃO pode mudar (comportamentos adjacentes, frases pinadas nos prompts, expectativas de evals existentes). |
| `falsifying_eval` | Qual eval/teste detectaria regressão ou provaria o efeito. Se nenhuma existe, o teste novo adicionado junto — mudança não-falsificável é rejeitada. |
| `rollback` | Passo exato de reversão. |

Além do contract: `evals` (resultado da suite completa + impact suites rodadas) e `decision` (applied/rejected/pending/dry-run, por quem, quando).

## Exemplo mínimo

```markdown
# 001 — dto-immutability-lint-rule

## Change contract
- surface: {context}/agent-context/lint-rules/dto-immutability.yml
- failure_mechanism: nada detecta mecanicamente `var` em data classes de DTO; a skill só recomenda em prosa
- evidence: PR #91, hunk em CashoutRequestData.kt (dev trocou `var amount` por `val amount`); check-review.md 2026-07-10, seção "Findings"
- expected_effect: detekt falha o build quando um DTO declara propriedade mutável
- preserved_invariants: regras detekt existentes do contexto; nenhuma frase pinada de prompt tocada
- falsifying_eval: teste novo em .opencode/evals (regra dispara no fixture mutável, silencia no imutável)
- rollback: git revert do commit que adiciona a regra

## Evals
- full suite: PASS (58/58)
- impact: nenhum (superfície é lint-rule, não plugin/carl/runtime/skill)

## Decision
- APPLIED — aprovado por kleber em 2026-07-16
```

## Regras que este diretório assume

- Nenhuma mudança é aplicada sem aprovação humana explícita (nunca auto-aplicar).
- Mudanças em permissões/segurança (`opencode.json` permissions, `j.env-protection`) exigem aprovação humana mesmo em nonInteractive.
- Regras validadas num modelo podem não valer após `model:set` — re-rodar as impact evals na troca de modelo.
