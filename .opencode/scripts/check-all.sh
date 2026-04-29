#!/bin/sh
set -e

__SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$__SCRIPT_DIR/_resolve-repo.sh"
. "$__SCRIPT_DIR/_detect-stack.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

TARGET_REPO_ROOT="$ROOT_DIR" sh "$WORKSPACE_ROOT/.opencode/scripts/harness-feature-integration.sh" switch-active >/dev/null 2>&1 || true

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -n "$CURRENT_BRANCH" ]; then
  echo "[juninho:check-all] Running on branch: $CURRENT_BRANCH"
fi

STACK="$(detect_stack)"
echo "[juninho:check-all] Stack: $STACK"

case "$STACK" in
  maven)
    MVN="$(maven_runner)" || {
      echo "[juninho:check-all] Maven stack detected but neither ./mvnw nor mvn available — skipping."
      exit 0
    }
    echo "[juninho:check-all] Running formatting checks (spotless)..."
    if pom_has_plugin spotless-maven-plugin; then
      $MVN -q spotless:check
    fi
    echo "[juninho:check-all] Running full verify (compile + tests + plugins)..."
    $MVN -q verify
    exit 0
    ;;
  terraform)
    if ! command -v terraform >/dev/null 2>&1; then
      echo "[juninho:check-all] Terraform stack detected but terraform CLI not in PATH — skipping."
      exit 0
    fi
    echo "[juninho:check-all] Running terraform fmt -check -recursive..."
    terraform fmt -check -recursive
    echo "[juninho:check-all] Running terraform validate..."
    terraform validate
    exit 0
    ;;
  node)
    has_package_script() {
      [ -f package.json ] || return 1
      node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
    }

    echo "[juninho:check-all] Running formatting checks..."
    if has_package_script "lint"; then
      npm run lint
    elif has_package_script "check:all"; then
      npm run check:all
    fi

    echo "[juninho:check-all] Running repo-wide tests..."
    if has_package_script "check:all"; then
      npm run check:all
      exit 0
    fi

    if has_package_script "typecheck"; then
      npm run typecheck
    fi

    if has_package_script "test"; then
      npm test
      exit 0
    fi

    echo "[juninho:check-all] No full verification command configured for $ROOT_DIR."
    echo "[juninho:check-all] Customize .opencode/scripts/check-all.sh or run /j.finish-setup."
    exit 0
    ;;
  unknown|*)
    echo "[juninho:check-all] Unknown stack at $ROOT_DIR — no checks to run."
    exit 0
    ;;
esac
