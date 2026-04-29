#!/bin/sh
set -e

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

staged_files_as_args() {
  printf '%s\n' "$JUNINHO_STAGED_FILES" | sed '/^$/d' | tr '\n' ' '
}

FILES="$(staged_files_as_args)"

if [ -z "$FILES" ]; then
  echo "[juninho:lint-structure] No staged files. Skipping."
  exit 0
fi
has_package_script() {
  [ -f package.json ] || return 1
  node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1" >/dev/null 2>&1
}

if has_package_script "lint:structure"; then
  npm run lint:structure -- $FILES
  exit 0
fi

if has_package_script "lint"; then
  npm run lint -- --max-warnings=0 $FILES
  exit 0
fi

if command -v npx >/dev/null 2>&1 && npx --yes eslint --version >/dev/null 2>&1; then
  npx eslint --max-warnings=0 $FILES
  exit 0
fi

echo "[juninho:lint-structure] No structure lint configured."
echo "[juninho:lint-structure] Customize .opencode/scripts/lint-structure.sh or run /j.finish-setup."
