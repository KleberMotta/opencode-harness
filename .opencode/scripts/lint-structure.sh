#!/bin/sh
set -e

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_resolve-repo.sh"
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_detect-stack.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

staged_files_as_args() {
  printf '%s\n' "$JUNINHO_STAGED_FILES" | sed '/^$/d' | tr '\n' ' '
}

FILES="$(staged_files_as_args)"
STACK="$(detect_stack)"

if [ -z "$FILES" ]; then
  echo "[juninho:lint-structure] No staged files. Skipping."
  exit 0
fi

case "$STACK" in
  maven)
    MVN="$(maven_runner)" || {
      echo "[juninho:lint-structure] Stack: maven — no ./mvnw or mvn found, skipping."
      exit 0
    }
    maven_check_java_version || exit 1
    # Context-scoped detekt rules (infra for pillar A3): when the repo's
    # nearest containing `.context/lint-rules/` ships
    # a rules jar AND a detekt.yml config AND the detekt CLI is on PATH, run
    # it as a blocking gate. Default rulesets stay disabled: only the team's
    # custom rules (activated via detekt.yml) gate the commit — otherwise a
    # legacy repo would fail on every default-ruleset finding. Test sources
    # are included because rules like NoMockBean target test code.
    # Missing jar, config, or binary → silent skip.
    case "$ROOT_DIR" in
      "$WORKSPACE_ROOT/contexts"/*)
        __lint_parent="$(dirname "$ROOT_DIR")"
        __lint_rules_dir=""
        while [ "$__lint_parent" != "$WORKSPACE_ROOT/contexts" ] && [ "$__lint_parent" != "$(dirname "$__lint_parent")" ]; do
          if [ -d "$__lint_parent/.context/lint-rules" ]; then
            __lint_rules_dir="$__lint_parent/.context/lint-rules"
            break
          fi
          __lint_parent="$(dirname "$__lint_parent")"
        done
        __lint_rules_jar="$__lint_rules_dir/rules.jar"
        __lint_rules_cfg="$__lint_rules_dir/detekt.yml"
        if [ -n "$__lint_rules_dir" ] && [ -f "$__lint_rules_jar" ] && [ -f "$__lint_rules_cfg" ] && command -v detekt >/dev/null 2>&1; then
          __lint_inputs=""
          for __lint_dir in src/main/kotlin src/test/kotlin; do
            [ -d "$__lint_dir" ] && __lint_inputs="${__lint_inputs:+$__lint_inputs,}$__lint_dir"
          done
          if [ -n "$__lint_inputs" ]; then
            echo "[juninho:lint-structure] Stack: maven — running detekt (context rules: $__lint_rules_dir)"
            detekt --plugins "$__lint_rules_jar" --disable-default-rulesets --config "$__lint_rules_cfg" --input "$__lint_inputs"
          fi
          unset __lint_inputs __lint_dir
        fi
        unset __lint_parent __lint_rules_dir __lint_rules_jar __lint_rules_cfg
        ;;
    esac
    if pom_has_plugin spotless-maven-plugin; then
      echo "[juninho:lint-structure] Stack: maven — running $MVN spotless:check"
      $MVN -q spotless:check
      exit 0
    fi
    if pom_has_plugin maven-checkstyle-plugin; then
      echo "[juninho:lint-structure] Stack: maven — running $MVN checkstyle:check"
      $MVN -q checkstyle:check -DfailOnViolation=true
      exit 0
    fi
    echo "[juninho:lint-structure] Stack: maven — no spotless/checkstyle plugin in pom.xml, skipping."
    exit 0
    ;;
  terraform)
    if ! command -v terraform >/dev/null 2>&1; then
      echo "[juninho:lint-structure] Stack: terraform — terraform CLI not in PATH, skipping."
      exit 0
    fi
    echo "[juninho:lint-structure] Stack: terraform — running terraform fmt -check -recursive"
    terraform fmt -check -recursive
    exit 0
    ;;
  node)
    has_package_script() {
      [ -f package.json ] || return 1
      node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
    }

    # Check if eslint is actually configured (config file exists).
    has_eslint_config() {
      for __ec_f in eslint.config.js eslint.config.mjs eslint.config.cjs .eslintrc .eslintrc.js .eslintrc.json .eslintrc.yml .eslintrc.yaml; do
        if [ -f "$__ec_f" ]; then
          unset __ec_f
          return 0
        fi
      done
      unset __ec_f
      # Also check package.json for "eslintConfig" key
      [ -f package.json ] && node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); process.exit(p.eslintConfig ? 0 : 1)" >/dev/null 2>&1 && return 0
      return 1
    }

    if has_package_script "lint:structure"; then
      echo "[juninho:lint-structure] Stack: node — running npm run lint:structure"
      npm run lint:structure -- $FILES
      exit 0
    fi

    if has_package_script "lint"; then
      echo "[juninho:lint-structure] Stack: node — running npm run lint"
      npm run lint -- --max-warnings=0 $FILES
      exit 0
    fi

    if has_eslint_config && command -v npx >/dev/null 2>&1 && npx --no-install eslint --version >/dev/null 2>&1; then
      echo "[juninho:lint-structure] Stack: node — running npx eslint"
      npx --no-install eslint --max-warnings=0 $FILES
      exit 0
    fi

    echo "[juninho:lint-structure] Stack: node — no linter configured (no eslint config, no lint script). Skipping."
    exit 0
    ;;
  unknown|*)
    echo "[juninho:lint-structure] Stack: unknown — no pom.xml/mvnw, *.tf, or package.json in $ROOT_DIR. Skipping."
    exit 0
    ;;
esac
