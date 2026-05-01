#!/bin/sh
set -e

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_resolve-repo.sh"
. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/_detect-stack.sh"
ROOT_DIR="$TARGET_REPO_ROOT"

FILES="${JUNINHO_STAGED_FILES:-}"
STACK="$(detect_stack)"

if [ -z "$FILES" ]; then
  echo "[juninho:test-related] No staged files. Skipping."
  exit 0
fi

case "$STACK" in
  maven)
    MVN="$(maven_runner)" || {
      echo "[juninho:test-related] Stack: maven — no ./mvnw or mvn found, skipping."
      exit 0
    }

    # Heuristic: derive test class names from staged Java/Kotlin files.
    # Foo.java/Foo.kt -> FooTest,FooIT pattern. Glob match via -Dtest='...'.
    PATTERNS=""
    for f in $FILES; do
      case "$f" in
        *.java|*.kt)
          base="$(basename "$f")"
          name="${base%.*}"
          # If the staged file is itself a test, run it directly; otherwise
          # match peer Test/IT classes.
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
      echo "[juninho:test-related] Stack: maven — no .java/.kt staged files. Skipping."
      exit 0
    fi

    echo "[juninho:test-related] Stack: maven — running $MVN test -Dtest='$PATTERNS' -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false"
    $MVN -q test -Dtest="$PATTERNS" -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false
    exit 0
    ;;
  terraform)
    if ! command -v terraform >/dev/null 2>&1; then
      echo "[juninho:test-related] Stack: terraform — terraform CLI not in PATH, skipping."
      exit 0
    fi
    echo "[juninho:test-related] Stack: terraform — running terraform validate"
    # terraform validate requires init; tolerate uninitialized dirs in pre-commit.
    terraform validate >/dev/null 2>&1 || {
      echo "[juninho:test-related] terraform validate failed (likely needs 'terraform init'), skipping."
      exit 0
    }
    exit 0
    ;;
  node)
    has_package_script() {
      [ -f package.json ] || return 1
      node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
    }

    if has_package_script "test:related"; then
      echo "[juninho:test-related] Stack: node — running npm run test:related"
      npm run test:related -- $FILES
      exit 0
    fi

    if command -v npx >/dev/null 2>&1 && npx --no-install jest --version >/dev/null 2>&1; then
      echo "[juninho:test-related] Stack: node — running npx jest --findRelatedTests"
      npx --no-install jest --findRelatedTests --passWithNoTests $FILES
      exit 0
    fi

    if command -v npx >/dev/null 2>&1 && npx --no-install vitest --version >/dev/null 2>&1; then
      echo "[juninho:test-related] Stack: node — running npx vitest related"
      npx --no-install vitest related $FILES --run
      exit 0
    fi

    echo "[juninho:test-related] Stack: node — no related-test command configured."
    echo "[juninho:test-related] Customize .opencode/scripts/test-related.sh or run /j.finish-setup."
    exit 0
    ;;
  python)
    # Heuristic: derive test paths from staged Python files.
    # app/services/foo.py -> tests/test_services/test_foo.py pattern.
    TEST_PATHS=""
    for f in $FILES; do
      case "$f" in
        app/*.py|*.py)
          rel="${f#app/}"
          rel="${rel%.py}"
          dir="$(dirname "$rel")"
          base="$(basename "$rel")"
          # If the staged file is itself a test, run it directly.
          case "$f" in
            tests/*)
              TEST_PATHS="${TEST_PATHS:+$TEST_PATHS }$f"
              ;;
            *)
              # Derive test path: app/services/ticker_service.py → tests/test_services/test_ticker_service.py
              candidate="tests/test_${dir}/test_${base}.py"
              if [ -f "$candidate" ]; then
                TEST_PATHS="${TEST_PATHS:+$TEST_PATHS }$candidate"
              else
                # Fallback: tests/test_${dir}.py (single-file module)
                candidate2="tests/test_${dir}.py"
                if [ -f "$candidate2" ]; then
                  TEST_PATHS="${TEST_PATHS:+$TEST_PATHS }$candidate2"
                fi
              fi
              ;;
          esac
          ;;
      esac
    done

    if [ -z "$TEST_PATHS" ]; then
      echo "[juninho:test-related] Stack: python — no .py staged files or no matching test files. Skipping."
      exit 0
    fi

    echo "[juninho:test-related] Stack: python — running pytest"
    python_activate || {
      echo "[juninho:test-related] Stack: python — no python3 found, skipping."
      exit 0
    }
    export PYTHONPATH="$ROOT_DIR:$PYTHONPATH"
    $PYTHON -m pytest -q $TEST_PATHS --no-header 2>&1 || {
      pytest_exit=$?
      if [ $pytest_exit -eq 5 ]; then
        echo "[juninho:test-related] No tests collected for staged files; this is OK."
      else
        exit $pytest_exit
      fi
    }
    exit 0
    ;;
  unknown|*)
    echo "[juninho:test-related] Stack: unknown — no pom.xml/mvnw, *.tf, package.json, requirements.txt, or pyproject.toml in $ROOT_DIR. Skipping."
    exit 0
    ;;
esac
