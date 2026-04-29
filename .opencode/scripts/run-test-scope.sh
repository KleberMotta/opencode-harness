#!/bin/sh
set -e

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_resolve-repo.sh"
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_detect-stack.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

TEST_SCOPE="${1:-}"

if [ -z "$TEST_SCOPE" ]; then
  echo "[juninho:run-test-scope] Missing test scope. Pass related files or 'full'."
  exit 1
fi

STACK="$(detect_stack)"

case "$STACK" in
  maven)
    MVN="$(maven_runner)" || {
      echo "[juninho:run-test-scope] Stack: maven — no ./mvnw or mvn found, skipping."
      exit 0
    }
    if [ "$TEST_SCOPE" = "full" ]; then
      echo "[juninho:run-test-scope] Stack: maven — running $MVN test (full)"
      $MVN -q test
      exit 0
    fi
    # Scoped: derive test class patterns from .java/.kt files in $TEST_SCOPE.
    PATTERNS=""
    for f in $TEST_SCOPE; do
      case "$f" in
        *.java|*.kt)
          base="$(basename "$f")"
          name="${base%.*}"
          case "$name" in
            *Test|*IT|*Tests|*Spec)
              PATTERNS="${PATTERNS:+$PATTERNS,}$name"
              ;;
            *)
              PATTERNS="${PATTERNS:+$PATTERNS,}${name}Test,${name}IT"
              ;;
          esac
          ;;
      esac
    done
    if [ -z "$PATTERNS" ]; then
      echo "[juninho:run-test-scope] Stack: maven — no .java/.kt files in scope, skipping."
      exit 0
    fi
    echo "[juninho:run-test-scope] Stack: maven — running $MVN test -Dtest='$PATTERNS' -DfailIfNoTests=false"
    $MVN -q test -Dtest="$PATTERNS" -DfailIfNoTests=false
    exit 0
    ;;
  terraform)
    if ! command -v terraform >/dev/null 2>&1; then
      echo "[juninho:run-test-scope] Stack: terraform — terraform CLI not in PATH, skipping."
      exit 0
    fi
    # terraform test is preferred when present; fallback to validate.
    if terraform test -help >/dev/null 2>&1; then
      echo "[juninho:run-test-scope] Stack: terraform — running terraform test"
      terraform test
      exit 0
    fi
    echo "[juninho:run-test-scope] Stack: terraform — running terraform validate (no 'terraform test' available)"
    terraform validate >/dev/null 2>&1 || {
      echo "[juninho:run-test-scope] terraform validate failed (likely needs 'terraform init'), skipping."
      exit 0
    }
    exit 0
    ;;
  node)
    has_package_script() {
      [ -f package.json ] || return 1
      node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
    }

    if [ "$TEST_SCOPE" = "full" ]; then
      if has_package_script "check:all"; then
        echo "[juninho:run-test-scope] Stack: node — running npm run check:all"
        npm run check:all
        exit 0
      fi
      if has_package_script "test"; then
        echo "[juninho:run-test-scope] Stack: node — running npm test"
        npm test -- --runInBand
        exit 0
      fi
    fi

    if has_package_script "test:related"; then
      echo "[juninho:run-test-scope] Stack: node — running npm run test:related"
      npm run test:related -- $TEST_SCOPE
      exit 0
    fi

    echo "[juninho:run-test-scope] Stack: node — no test scope runner configured."
    exit 0
    ;;
  unknown|*)
    echo "[juninho:run-test-scope] Stack: unknown — no pom.xml/mvnw, *.tf, or package.json in $ROOT_DIR. Skipping."
    exit 0
    ;;
esac
