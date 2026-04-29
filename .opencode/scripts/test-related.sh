#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

FILES="${JUNINHO_STAGED_FILES:-}"

if [ -z "$FILES" ]; then
  echo "[juninho:test-related] No staged files. Skipping."
  exit 0
fi

has_package_script() {
  [ -f package.json ] || return 1
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
}

if has_package_script "test:related"; then
  npm run test:related -- $FILES
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --yes jest --version >/dev/null 2>&1; then
  npx jest --findRelatedTests --passWithNoTests $FILES
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --yes vitest --version >/dev/null 2>&1; then
  npx vitest related $FILES --run
  exit 0
fi

echo "[juninho:test-related] No related-test command configured."
echo "[juninho:test-related] Customize .opencode/scripts/test-related.sh or run /j.finish-setup."
