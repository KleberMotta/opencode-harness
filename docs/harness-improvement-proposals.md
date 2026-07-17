# Propostas de evolução do harness Juninho — determinismo de padrões

> Gerado em 2026-07-16 a partir de: survey "Code as Agent Harness" (Ning et al., arXiv:2605.18747), paper "Self-Harness" (Zhang et al., arXiv:2606.09498 via VentureBeat), Evil Martians "Stop writing rules in AGENTS.md", docs oficiais do opencode (references/rules/skills) e airscripts/agentskill — cruzados com o diagnóstico completo do harness feito em 16/07/2026.
>
> Tese consolidada das fontes: **determinismo não vem de instruir melhor o modelo; vem de sensores determinísticos + transições de estado governadas + regras medidas (não descritas) + evolução do próprio harness com gate de regressão.**

## 0. O recurso `references` do opencode — por que adotar

Verificado: suportado e validado pelo schema no opencode 1.17.20 instalado. O que ele dá ao harness:

1. **Fonte única de verdade para padrões cross-repo.** Hoje o `CONTEXT.md` e as skills *copiam* trechos de convenções de outros repos (ex.: estilo de teste do trp-financial-api citado no j.implementer.md). Cópia dessincroniza. Uma reference `{"path": "../olxbr/trp-financial-api", "description": "Use for canonical unit/controller test style"}` mantém o canon navegável no lugar de origem.
2. **Anúncio barato, conteúdo lazy.** Reference com `description` entra no system context como UMA linha (path + quando usar); o conteúdo só é lido sob demanda. É o meio-termo exato entre rules (sempre pago, ~KB) e skills (invisível até invocar) — resolve o problema que o carl-inject ataca com heurística de keywords, mas por mecanismo nativo e determinístico na *disponibilidade*.
3. **Elimina uma classe de plugin.** `referenceProjects` do active-plan hoje viram texto injetado pelo plan-autoload. Como references nativos, o opencode gerencia a fronteira de permissão (`external_directory`) e o `@alias` no TUI de graça.
4. **Pinável.** Referências git aceitam `branch`/ref — um guia de padrões pode ser pinado a uma tag (ressalva verificada: um checkout por repo, refresh assíncrono; para repos irmãos locais, `path` não tem esse problema).
5. **Controle fino humano × agente.** Reference sem `description` fica disponível ao humano (`@`) sem influenciar o agente.

Limite honesto (da própria doc): o anúncio é convite, não obrigação — o agente *pode* não consultar. References resolvem **disponibilidade determinística**; a **aplicação** continua sendo papel dos gates (pilar A).

---

## Pilar A — Enforcement no loop: interceptar, não pedir

*Embasamento: Evil Martians ("every rule you can encode as a tool is a rule the LLM can't forget"); survey §3.4 (AutoHarness: filtrar ação inválida ANTES de executar; L2MAC: check bloqueante após cada file write); Self-Harness (as regras que sobrevivem à validação são políticas de runtime, não conselhos de prompt).*

### A1. Auto-format Kotlin por edit (first-pass compliance) — P0
**Hoje:** `j.auto-format` cobre prettier/black/gofmt/rustfmt — **zero cobertura Kotlin**, a linguagem de todos os repos-alvo. Consequência medida: na feature real de junho, um ciclo inteiro de `/j.check` (7,6 min + commit `201c789 fix ktfmt`) foi gasto só com formatação.
**Proposta:** estender `j.auto-format` para `.kt`/`.java` aplicando o formatter do repo por arquivo no `tool.execute.after` de write/edit (ou evento `file.edited`): ktfmt para os repos spotless+ktfmt (o jar `ktfmt-0.53` já está em `~/.m2`), google-java-format para os demais; detectar pelo pom (helper já existe: `pom_has_plugin`). Instalar CLIs via brew (`ktlint`/`ktfmt`) documentado no `bun run setup`.
**Efeito:** formatação deixa de existir como categoria de falha em pre-commit/check-all. O agentskill reforça: "an agent must produce formatter-compliant code on the first pass" — auto-fix por edit é o mais perto disso que um hook alcança.

### A2. Intent-gate com modo bloqueante (plano como contrato aplicado) — P1
**Hoje:** o `j.intent-gate` só *avisa* quando um edit sai do escopo do plano. O survey (§3.4.2) é explícito: o plano deve **restringir o espaço de ação** — quais arquivos podem ser editados é contrato, não sugestão.
**Proposta:** toggle `workflow.implement.enforcePlanScope` (default `false` até ganhar confiança): em sessões task-scoped, edit em arquivo fora do `### Files` da task (+ paths de estado do harness) → `throw` no `tool.execute.before` com mensagem citando o contrato e o caminho de escape ("adicione o arquivo à task via follow-up ou peça ao dev"). Whitelist para edits mecânicos triviais (imports do mesmo pacote).
**Efeito:** scope creep vira impossível em vez de desaconselhado. É o padrão AutoHarness (filtrar antes > reparar depois).

### A3. Pipeline de escalonamento de regra: review recorrente → regra executável — P1
**Embasamento:** Evil Martians ("erro recorrente não vira parágrafo no AGENTS.md — vira regra de lint custom que o próprio LLM escreve"); verificado: detekt aceita rule sets locais via jar (`--plugins`), nenhum repo olxbr usa detekt hoje.
**Proposta:** criar `.opencode/lint-rules/` no workspace com um projeto detekt de regras customizadas compartilhado; quando um achado de review/validator se repete (≥2 features), o fluxo de auto-learning propõe **regra detekt** em vez de prosa — e o `lint-structure.sh` ganha um passo detekt opcional (`--plugins $WORKSPACE/.opencode/lint-rules/rules.jar`) gated por config. Critério de triagem (Evil Martians): lintável → linter; arquitetural/negócio → skill/AGENTS.md; comportamental do agente → plugin.
**Efeito:** o estoque de "regras que o modelo não pode esquecer" cresce monotonicamente; AGENTS.md/skills param de inchar com o que é mecanizável.

---

## Pilar B — Regras medidas, não descritas

*Embasamento: agentskill (convenções implícitas "an LLM cannot derive reliably from reading source files alone" — medir com analisadores determinísticos, LLM só sintetiza; Mimicry Test; evidência ≥3 exemplos; RED_LINES com quota); survey §3.1.2 (repositório agent-native: convenções como artefatos versionados consultados antes de agir).*

### B1. /j.finish-setup vira pipeline evidência→síntese — P1
**Hoje:** as skills j.*-writing foram escritas à mão; nada garante que refletem o repo real (a parte TS do j.test-writing, por exemplo, é herança de template inaplicável aos repos Kotlin).
**Proposta:** adicionar a `.opencode/scripts/` analisadores determinísticos no molde do agentskill — `measure` (indentação real, p95 de linha, blank lines), `symbols` (clustering de nomes/afixos), `git` (prefixos de commit, naming de branch), `tests` (mapeamento teste→fonte, fixtures) — emitindo JSON. O `/j.finish-setup` passa a: rodar analisadores → LLM sintetiza skills/AGENTS **citando evidência** (regra só com ≥3 exemplos reais; menos → `[tentative]`; "prose describes, snippets prove") → seção RED_LINES com quota (≥10 proibições ancoradas no que ESTE repo evita). Re-runs preservam seções manuais (sidecar de pins, padrão `update` do agentskill).
**Efeito:** cada regra nas skills passa a ter lastro medido — o antídoto contra o AGENTS.md genérico que o modelo ignora.

### B2. Skills em 3 camadas com definition-of-done — P2
**Proposta:** para as skills de writing: `SKILL.md` (workflow) + `SYSTEM.md` (spec do output: o Mimicry Test — "se um agente seguisse só isto, o código seria mergeável sem fix de estilo?") + `GOTCHAS.md` (memória de falhas da skill, alimentada pelo /j.learn do pilar D). Precedência declarada (SYSTEM > SKILL). Bônus: `description:` bem escrita habilita a tool nativa `skill` do opencode como segunda via de carga.

---

## Pilar C — Verificação como contrato, convergência governada

*Embasamento: survey §3.4/§5.2 ("the green test is not the full specification"; verification como "evolving, inspectable contract"; terminação governada por verificação, nunca por confiança do modelo; QualityFlow rollback; PairCoder detecção de repetição; "debugging decay index" — eficácia decai com iterações).*

### C1. check-review como evidence bundle + roteamento tipado — P1
**Hoje:** `check-review.md` tem Critical/Important/Minor + Reentry Contract textual.
**Proposta:** o checker passa a emitir, junto do verdict, um bloco estruturado: para cada check — escopo, o que NÃO cobre, e a falha classificada por tipo com rota: `compile → reentrar task N`, `format → autofix direto (A1)`, `test-failure → diagnóstico comportamental`, `coverage-gap → task j.test-writer`, `style-recorrente → candidato a regra detekt (A3)`. O Reentry Contract vira dispatch mecânico em vez de prosa interpretável.
**Efeito:** feedback estruturado direciona o reparo certo pro agente certo ("localizar o bug, não só sinalizá-lo") e alimenta o weakness mining do pilar D.

### C2. Convergência com cap, detecção de repetição e rollback — P0
**Hoje:** o loop check→implement pode reentrar indefinidamente; na feature de junho, 43 testes de infra insolúveis geravam reentradas inúteis (mitigado pelo auto-`make dependencies`, mas o padrão persiste para outras causas).
**Proposta:** (a) `workflow.check.maxReentries` (default 2) — estourou, escala a humano com o evidence bundle; (b) detecção de repetição: hash do conjunto de falhas por rodada em `check-review.md`; mesmo hash 2× → parar (PairCoder: repetição = beco sem saída, não persistência); (c) rollback: se uma rodada de fix *aumentar* as falhas, `git reset --hard` ao último `validatedCommit` do `integration-state.json` e escalar (QualityFlow: nunca deixar debug degradar estado válido).
**Efeito:** o pior cenário do harness (a cauda de horas queimando tokens) ganha teto mecânico. É "termination governed by verification, not model confidence" aplicado.

### C3. Testes independentes da implementação — P2
**Embasamento:** AgentCoder/FlowGen (survey §4.1): testes gerados olhando a implementação herdam os vieses dela — "converge on code that passes its own biased tests".
**Proposta:** regra no prompt do `j.test-writer` + template do planner: tasks de teste derivam asserts do **spec/plan/CONTEXT (contrato de comportamento)**, lendo a implementação apenas para wiring (nomes, DI) — nunca para decidir o que assertar.

---

## Pilar D — Evolução governada do harness (Self-Harness sobre a infra que já existe)

*Embasamento: Self-Harness (weakness mining com assinatura determinística → proposta mínima 1-falha-1-superfície com audit record → aceitação só com Δheld-in ≥ 0 E Δheld-out ≥ 0); survey §3.5/§5.2.3 ("a harness mutation should be treated like a code change to a safety-critical runtime"; change contract; replay).*

O ponto-chave: **o juninho já tem os dois pré-requisitos** que o Self-Harness exige — verificadores determinísticos (suite 53 testes + evals behavioral com suites `impact:carl/runtime/workflow/tools`) e superfícies editáveis discretas (agents/, commands/, plugins/, skills/, scripts/). Falta só o processo.

### D1. Comando /j.learn — auto-learning com change contract e gate de regressão — P0
**Hoje:** o auto-learning é prosa no AGENTS.md ("propõe update, aplica com aprovação") — sem formato, sem validação, sem histórico.
**Proposta:** `/j.learn <correção observada>` executa: (1) *weakness signature* — classifica a falha por mecanismo raiz (não sintoma), com evidência do trace/diff; (2) proposta **mínima**: toca exatamente 1 superfície (um agent .md, um plugin, uma skill, uma regra detekt via A3), mapeia exatamente 1 padrão de falha; (3) *audit record* (change contract): superfície, falha alvo, efeito esperado, invariantes preservados, **qual eval pode falsificar**; (4) roda `npm run eval` + a suite behavioral de impacto da superfície tocada; aceita só sem regressão; (5) apresenta o audit record ao dev para aprovação; (6) aplica e registra em `docs/harness-changes/NNN-<slug>.md`.
**Efeito:** o conjunto de regras cresce monotonicamente só com edições comprovadas e rastreáveis a falha real — em vez de prompts que incham por intuição. Nota do paper: regras ótimas são *model-specific* → `model:set` deve sugerir re-rodar as evals de impacto.

### D2. Telemetria de primeira classe — P1
**Verificado:** os eventos `message.part.updated` (step_finish) do opencode 1.17.20 carregam `tokens` e `cost`; `file.edited`, `command.executed`, `session.diff` existem.
**Proposta:** plugin `j.telemetry` (só listener de eventos, zero injeção) gravando `docs/specs/{slug}/state/metrics.jsonl`: por sessão/task — tokens, custo, nº de tool calls, arquivos editados, comandos, falhas de hook, reentradas. `/j.unify` agrega num sumário por feature. São as métricas de harness do survey (eficiência de trajetória, força de verificação, recovery, replayability) e o combustível do weakness mining do D1 — sem isso, "melhoria" de harness é anedota ("telemetry turns harness revision from anecdotal debugging into comparative diagnosis").

### D3. references materializados a partir do plano — P0 (quick win)
**Proposta:** `plan:activate`/`sync-config` geram o bloco `references` do opencode.json a partir do active-plan: cada `referenceProject` vira `{path: <targetRepoRoot relativo>, description: <reason>}`; adicionalmente uma reference fixa `test-canon` → trp-financial-api. O plan-autoload para de injetar referenceProjects como texto.
**Efeito:** disponibilidade nativa, permissão gerenciada pelo opencode, `@alias` no TUI, e um plugin a menos fazendo trabalho manual.

---

## Ordem recomendada

| Prioridade | Proposta | Custo | Retorno |
|---|---|---|---|
| P0 | A1 auto-format Kotlin por edit | baixo | elimina categoria inteira de falha de check |
| P0 | C2 cap + repetição + rollback no check-loop | baixo | teto mecânico para o pior cenário de custo |
| P0 | D3 references do plano | baixo | contexto cross-repo nativo e determinístico |
| P1 | D1 /j.learn com gate de regressão | médio | evolução do harness sem regressão — multiplicador de tudo |
| P1 | C1 evidence bundle + roteamento tipado | médio | reparo direcionado, menos ciclos |
| P1 | A2 intent-gate bloqueante | baixo | escopo do plano vira contrato aplicado |
| P1 | B1 finish-setup medido | médio | skills com lastro real por repo |
| P1 | D2 telemetria | médio | pré-requisito de melhoria mensurável |
| P2 | A3 detekt rules pipeline | médio | regras inesquecíveis crescendo com o uso |
| P2 | B2 skills 3 camadas / C3 testes independentes | baixo | qualidade incremental |

Princípio transversal (de todas as fontes): cada uma dessas mudanças, quando implementada, deve passar pelo próprio processo que propõem — mudança mínima, com eval que a falsifique, validada na suite antes de virar regra.
