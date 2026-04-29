## Resumo

<!-- 1-3 linhas: o que muda e por quê. -->

## Contexto

<!-- Link para spec/plan/issue, ou descrição do problema que motivou o PR.
     Ex.: "Auditoria de incompatibilidade do harness com workspace multi-projeto"
          "Refator de checker para suportar Maven além de Node"
-->

## Mudanças principais

<!-- Lista de áreas tocadas. Agrupe por subsistema do harness:
     - Agents (.opencode/agents/**)
     - Plugins (.opencode/plugins/**)
     - Scripts (.opencode/scripts/**)
     - Skills (.opencode/skills/**)
     - Commands (.opencode/commands/**)
     - CLI (.opencode/cli/** + package.json)
     - Lib helpers (.opencode/lib/**)
     - Docs (README, docs/**)
     - Config (juninho-config.json, skill-map.json)
-->

- ...
- ...

## Arquivos novos / helpers

<!-- Liste contratos públicos novos: scripts em scripts/, helpers em lib/,
     toggles em juninho-config.json, etc. Documente entradas/saídas mínimas.
     Apague a seção se não houver. -->

## Toggles / config

<!-- Mudanças em juninho-config.json. Defaults novos? Toggles novos?
     Apague se não houver. -->

## Como testar

<!-- Smokes manuais executados + comandos para reproduzir.
     Inclua resultado esperado (ex.: "todos os 7 smokes ✅"). -->

```bash
# exemplo
JUNINHO_FORCE_STACK=maven ./.opencode/scripts/check-all.sh
```

## Decisões de design

<!-- Escolhas não-óbvias e o motivo. Ex.:
     - "Detecção de stack via FS markers (não config) para robustez."
     - "Helper config retorna default em vez de exit 1 para não quebrar scripts antigos." -->

## Riscos / blast radius

<!-- O que pode quebrar? Quais write targets foram exercitados?
     Quais não foram (e por quê é seguro)? -->

## Checklist

- [ ] Smokes manuais passaram (ver "Como testar")
- [ ] Sem regressão em scripts não tocados (executados ao menos 1x)
- [ ] Docs atualizadas (README seção apropriada, AGENTS.md se mudou contrato)
- [ ] `juninho-config.json` defaults preservam comportamento anterior
- [ ] Sem credenciais/paths absolutos do laptop hardcoded
- [ ] Branch é `feature/<slug>`, `chore/<topic>` ou `fix/<topic>` (não `main`)
