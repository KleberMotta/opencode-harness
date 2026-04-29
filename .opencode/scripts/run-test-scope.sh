#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

TEST_SCOPE="${1:-}"

if [ -z "$TEST_SCOPE" ]; then
  echo "[juninho:run-test-scope] Missing test scope. Pass related files or 'full'."
  exit 1
fi

has_package_script() {
  [ -f package.json ] || return 1
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
}

if [ "$TEST_SCOPE" = "full" ]; then
  if has_package_script "check:all"; then
    npm run check:all
    exit 0
  fi
  if has_package_script "test"; then
    npm test -- --runInBand
    exit 0
  fi
fi

if has_package_script "test:related"; then
  npm run test:related -- $TEST_SCOPE
  exit 0
fi

echo "[juninho:run-test-scope] No test scope runner configured."
