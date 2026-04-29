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

    if command -v npx >/dev/null 2>&1 && npx --no-install eslint --version >/dev/null 2>&1; then
      echo "[juninho:lint-structure] Stack: node — running npx eslint"
      npx --no-install eslint --max-warnings=0 $FILES
      exit 0
    fi

    echo "[juninho:lint-structure] Stack: node — no structure lint configured."
    echo "[juninho:lint-structure] Customize .opencode/scripts/lint-structure.sh or run /j.finish-setup."
    exit 0
    ;;
  unknown|*)
    echo "[juninho:lint-structure] Stack: unknown — no pom.xml/mvnw, *.tf, or package.json in $ROOT_DIR. Skipping."
    exit 0
    ;;
esac
