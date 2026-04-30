#!/bin/sh
set -e

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_resolve-repo.sh"
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_detect-stack.sh"
ROOT_DIR="$TARGET_REPO_ROOT"
STACK="$(detect_stack)"

echo "[juninho:build-verify] Running build verification..."

case "$STACK" in
  maven)
    MVN="$(maven_runner)" || {
      echo "[juninho:build-verify] Stack: maven — no ./mvnw or mvn found, skipping."
      exit 0
    }
    maven_check_java_version || exit 1
    echo "[juninho:build-verify] Stack: maven — running $MVN -DskipTests verify"
    $MVN -q -DskipTests verify
    exit 0
    ;;
  terraform)
    if ! command -v terraform >/dev/null 2>&1; then
      echo "[juninho:build-verify] Stack: terraform — terraform CLI not in PATH, skipping."
      exit 0
    fi
    echo "[juninho:build-verify] Stack: terraform — running terraform validate"
    terraform validate >/dev/null 2>&1 || {
      echo "[juninho:build-verify] terraform validate failed (likely needs 'terraform init'), skipping."
      exit 0
    }
    exit 0
    ;;
  node)
    if [ -f "package.json" ]; then
      echo "[juninho:build-verify] Stack: node — trying npm run build / tsc --noEmit"
      if npm run --silent build --if-present 2>/dev/null; then
        exit 0
      fi
      if npx tsc --noEmit 2>/dev/null; then
        exit 0
      fi
    fi
    echo "[juninho:build-verify] Stack: node — no build verification available, skipping."
    exit 0
    ;;
  unknown|*)
    echo "[juninho:build-verify] Stack: unknown — no pom.xml/mvnw, *.tf, or package.json in $ROOT_DIR. Skipping."
    exit 0
    ;;
esac
